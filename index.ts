import { Parser } from '@traqula/parser-sparql-1-2'
import fs from 'node:fs'
import path from 'node:path'
import { SparqlTypesOptions } from './vite-plugin.ts'
import type { Literal, NamedNode } from '@rdfjs/types'
export { typedSparql } from './vite-plugin.ts'

  /**
   * This module provides a Vite plugin that generates TypeScript types for SPARQL SELECT queries defined in .rq files. By analyzing the structure of the SPARQL query and applying user-defined type rules, it produces precise typings for query results, enabling type-safe usage of SPARQL queries in a TypeScript codebase.
   *
   * @example
   * ```ts
   * import { typedSparql } from "@shapething/typed-sparql";
   *
   * const plugin = typedSparql({
   *   functions: {
   *     'sta:label': 'Literal',
   *     'sta:icon':  'Literal',
   *   },
   * });
   * ```
   *
   * @module
   */

const SPARQL_KEYWORDS = new Set([
  'SELECT', 'WHERE', 'FILTER', 'OPTIONAL', 'GRAPH', 'BIND', 'UNION', 'MINUS',
  'ORDER', 'LIMIT', 'OFFSET', 'GROUP', 'HAVING', 'AS', 'BY', 'ASC', 'DESC',
  'FROM', 'NAMED', 'SERVICE', 'SILENT', 'VALUES', 'INSERT', 'DELETE', 'WITH',
  'USING', 'LOAD', 'CLEAR', 'DROP', 'ADD', 'MOVE', 'COPY', 'CREATE', 'BASE',
  'PREFIX', 'CONSTRUCT', 'DESCRIBE', 'ASK', 'NOT', 'IN', 'EXISTS', 'DISTINCT',
  'REDUCED', 'SEPARATOR',
])

/**
 * Inserts dummy PREFIX declarations for any prefixed name that is used in the
 * query but not explicitly declared. This lets the parser handle queries that
 * rely on externally-provided prefix mappings.
 */
function addDummyPrefixes(query: string): string {
  const declared = new Set<string>()
  for (const m of query.matchAll(/PREFIX\s+(\w*)\s*:/gi)) {
    declared.add(m[1])
  }

  const used = new Set<string>()
  for (const m of query.matchAll(/\b([a-zA-Z]\w*):[a-zA-Z_]/g)) {
    if (!SPARQL_KEYWORDS.has(m[1].toUpperCase())) used.add(m[1])
  }

  const missing = [...used].filter(p => !declared.has(p))
  if (!missing.length) return query

  const decls = missing.map(p => `PREFIX ${p}: <http://dummy/${p}/>`).join('\n')
  return `${decls}\n${query}`
}

/**
 * Given a TermIri node from the traqula AST, return the lookup key used to
 * match against the user's `functions` option map.
 * Returns `prefix:localName` for prefixed IRIs, or the full IRI value.
 */
function termIriKey(fn: { value: string; prefix?: string }): string {
  return fn.prefix ? `${fn.prefix}:${fn.value}` : fn.value
}

/**
 * Built-in predicate → object type narrowing rules for well-known SHACL and
 * RDF predicates whose object is always a NamedNode.
 */
const BUILTIN_PREDICATE_OBJECT_TYPES: Record<string, string> = {
  // RDF / OWL
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type': 'NamedNode',
  'rdf:type': 'NamedNode',
  // SHACL target declarations
  'sh:targetClass': 'NamedNode',
  'sh:targetSubjectsOf': 'NamedNode',
  'sh:targetObjectsOf': 'NamedNode',
  // SHACL constraint components — class / datatype / nodeKind are always IRIs
  'sh:class': 'NamedNode',
  'sh:datatype': 'NamedNode',
  'sh:nodeKind': 'NamedNode',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function* walkPatterns(patterns: any[], skipOptional = false): Iterable<any> {
  for (const p of patterns) {
    if (skipOptional && p.type === 'pattern' && p.subType === 'optional') continue
    yield p
    if (Array.isArray(p.patterns)) yield* walkPatterns(p.patterns, skipOptional)
    if (p.type === 'query' && Array.isArray(p.where?.patterns))
      yield* walkPatterns(p.where.patterns, skipOptional)
  }
}

/**
 * Walks the WHERE clause pattern tree and returns the set of variable names
 * that are bound exclusively via BOUND(), meaning their runtime value is
 * always xsd:boolean.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectBooleanVars(patterns: any[]): Set<string> {
  const vars = new Set<string>()
  for (const p of walkPatterns(patterns)) {
    if (p.type === 'pattern' && p.subType === 'bind' &&
        p.expression?.type === 'expression' &&
        p.expression.subType === 'operation' &&
        p.expression.operator === 'bound') {
      vars.add(p.variable.value)
    }
  }
  return vars
}

/**
 * Walks the WHERE clause pattern tree and returns the set of variable names
 * that appear as the graph name in a GRAPH clause. Variables used as graph
 * names are always IRIs — they can never be blank nodes or literals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectGraphNameVars(patterns: any[]): Set<string> {
  const vars = new Set<string>()
  for (const p of walkPatterns(patterns)) {
    if (p.type === 'pattern' && p.subType === 'graph' &&
        p.name?.type === 'term' && p.name.subType === 'variable') {
      vars.add(p.name.value)
    }
  }
  return vars
}

/**
 * Walks the WHERE clause pattern tree and returns the set of variable names
 * that appear in the subject position of any triple pattern. In RDF, subjects
 * can only be IRIs or blank nodes — never literals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectSubjectVars(patterns: any[]): Set<string> {
  const vars = new Set<string>()
  for (const p of walkPatterns(patterns)) {
    if (p.type === 'pattern' && p.subType === 'bgp') {
      for (const triple of (p.triples ?? [])) {
        const subj = triple.subject
        if (subj?.type === 'term' && subj.subType === 'variable') {
          vars.add(subj.value)
        }
      }
    }
  }
  return vars
}

/**
 * Walks the WHERE clause pattern tree and returns the set of variable names
 * that are definitely bound — i.e. they appear outside any OPTIONAL block.
 * Variables that only ever appear inside OPTIONAL may be unbound in query
 * results and therefore need an optional (`?:`) property.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectDefinitelyBoundVars(patterns: any[]): Set<string> {
  const vars = new Set<string>()
  for (const p of walkPatterns(patterns, true)) {
    if (p.type === 'pattern' && p.subType === 'graph' &&
        p.name?.type === 'term' && p.name.subType === 'variable') {
      vars.add(p.name.value)
    }
    if (p.type === 'pattern' && p.subType === 'bgp') {
      for (const triple of (p.triples ?? [])) {
        for (const part of [triple.subject, triple.predicate, triple.object]) {
          if (part?.type === 'term' && part.subType === 'variable') vars.add(part.value)
        }
      }
    }
    if (p.type === 'pattern' && p.subType === 'bind' && p.variable?.value) {
      vars.add(p.variable.value)
    }
  }
  return vars
}

/**
 * Walks the WHERE clause pattern tree and returns a map from variable name →
 * TypeScript type for variables appearing in object position of predicates
 * with a known fixed object type (SHACL rules + user config).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectPredicateObjectVars(patterns: any[], options: SparqlTypesOptions): Map<string, string> {
  const predicateRules = { ...BUILTIN_PREDICATE_OBJECT_TYPES, ...options.predicateObjectTypes }
  const varTypes = new Map<string, string>()
  for (const p of walkPatterns(patterns)) {
    if (p.type === 'pattern' && p.subType === 'bgp') {
      for (const triple of (p.triples ?? [])) {
        const pred = triple.predicate
        if (pred?.type === 'term' && pred.subType !== 'variable') {
          const key = termIriKey(pred as { value: string; prefix?: string })
          const objType = predicateRules[key]
          if (objType) {
            const obj = triple.object
            if (obj?.type === 'term' && obj.subType === 'variable' && !varTypes.has(obj.value)) {
              varTypes.set(obj.value, objType)
            }
          }
        }
      }
    }
  }
  return varTypes
}

/**
 * Walks the WHERE clause pattern tree and returns a map from variable name →
 * TypeScript type for every variable bound via BIND() where we can derive a
 * type more specific than the generic fallback. Variables already classified
 * as boolean (via collectBooleanVars) are skipped so that the
 * aggregate-based xsd:boolean narrowing continues to work.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectBindVarTypes(patterns: any[], options: SparqlTypesOptions, boolVars: Set<string>, knownVarTypes: Map<string, string>): Map<string, string> {
  const bindTypes = new Map<string, string>()
  for (const p of walkPatterns(patterns)) {
    if (p.type === 'pattern' && p.subType === 'bind') {
      const varName: string | undefined = p.variable?.value
      if (varName && !boolVars.has(varName) && !bindTypes.has(varName)) {
        const t = exprType(p.expression, options, boolVars, knownVarTypes)
        // Only record when we can be more specific than the plain-variable default
        if (t !== 'NamedNode | BlankNode | Literal') {
          bindTypes.set(varName, t)
        }
      }
    }
  }
  return bindTypes
}

/**
 * Derives the TypeScript type string for an expression node appearing in a
 * projected BIND slot, using the user's function map as a hint.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exprType(expression: any, options: SparqlTypesOptions, boolVars: Set<string>, knownVarTypes: Map<string, string>): string {
  // Plain variable reference — look up against all collected type rules first
  if (expression.type === 'term' && expression.subType === 'variable') {
    const varName: string = expression.value
    if (boolVars.has(varName)) return `LiteralWithDatatype<'http://www.w3.org/2001/XMLSchema#boolean'>`
    return knownVarTypes.get(varName) ?? 'NamedNode | BlankNode | Literal'
  }

  // Custom or built-in function call
  if (expression.type === 'expression' && expression.subType === 'functionCall') {
    const key = termIriKey(expression.function as { value: string; prefix?: string })
    return options.functions?.[key] ?? 'Term'
  }

  // Aggregate functions (COUNT, SUM, AVG, MIN, MAX, GROUP_CONCAT, SAMPLE) always
  // produce a Literal result in SPARQL — numeric, boolean, or string depending on
  // the aggregate and its input, but never a NamedNode or BlankNode.
  if (expression.type === 'expression' && expression.subType === 'aggregate') {
    // If the aggregate's inner expression is a variable known to be boolean
    // (bound via BOUND() in the WHERE clause), narrow to the xsd:boolean datatype.
    const inner = expression.expression?.[0]
    if (inner?.type === 'term' && inner.subType === 'variable' && boolVars.has(inner.value)) {
      return `LiteralWithDatatype<'http://www.w3.org/2001/XMLSchema#boolean'>`
    }
    return 'Literal'
  }

  // Everything else (operations, literals, …)
  return 'Term'
}

/**
 * Finds .rq files in the given directory and all subdirectories, ignoring commonly excluded ones like node_modules and .git. Returns an array of file paths.
 */
export function findRqFiles(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && !['node_modules', '.git', 'dist'].includes(entry.name)) {
        files.push(...findRqFiles(full))
      } else if (entry.isFile() && entry.name.endsWith('.rq')) {
        files.push(full)
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return files
}

/**
 * Pure function: parses a SPARQL query string and returns the `.rq.d.ts` file
 * content, or `null` if no type declaration can be generated (non-SELECT
 * queries, SELECT *, parse errors, empty projections).
 */
export function generateDts(query: string, options: SparqlTypesOptions, parser: Parser): string | null {
  let ast: ReturnType<typeof parser.parse>
  try {
    ast = parser.parse(addDummyPrefixes(query))
  } catch {
    return null
  }

  if (ast.type !== 'query' || ast.subType !== 'select') return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wherePatterns = (ast as any).where?.patterns ?? []
  const boolVars = collectBooleanVars(wherePatterns)
  const graphNameVars = collectGraphNameVars(wherePatterns)
  const subjectVars = collectSubjectVars(wherePatterns)
  const definitelyBoundVars = collectDefinitelyBoundVars(wherePatterns)
  const predicateObjectVars = collectPredicateObjectVars(wherePatterns, options)

  // Build a unified variable → type map for cross-cutting lookups (e.g. aliased expressions)
  const knownVarTypes = new Map<string, string>()
  for (const v of subjectVars) knownVarTypes.set(v, 'NamedNode | BlankNode')
  for (const [k, v] of predicateObjectVars) knownVarTypes.set(k, v)
  for (const v of graphNameVars) knownVarTypes.set(v, 'NamedNode')

  const bindVarTypes = collectBindVarTypes(wherePatterns, options, boolVars, knownVarTypes)

  const fields: Array<{ name: string; tsType: string; optional: boolean }> = []

  for (const v of ast.variables) {
    if (v.type === 'wildcard') return null // SELECT * – variables unknown at compile time

    if (v.type === 'term' && v.subType === 'variable') {
      // Direct variable projection: SELECT ?foo
      // Priority: GRAPH name → BOUND() bool → predicate rule → subject position → WHERE-clause BIND type → generic fallback
      const tsType = graphNameVars.has(v.value)
        ? 'NamedNode'
        : boolVars.has(v.value)
          ? `LiteralWithDatatype<'http://www.w3.org/2001/XMLSchema#boolean'>`
          : predicateObjectVars.get(v.value) ?? (subjectVars.has(v.value) ? 'NamedNode | BlankNode' : undefined) ?? bindVarTypes.get(v.value) ?? 'NamedNode | BlankNode | Literal'
      const optional = !definitelyBoundVars.has(v.value)
      fields.push({ name: v.value, tsType, optional })
    } else if (v.type === 'pattern' && v.subType === 'bind') {
      // Aliased expression: SELECT (?expr AS ?foo) — always bound
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields.push({ name: (v as any).variable.value, tsType: exprType((v as any).expression, options, boolVars, knownVarTypes), optional: false })
    }
  }

  if (!fields.length) return null

  const usesLiteralWithDatatype = fields.some(f => f.tsType.includes('LiteralWithDatatype'))

  // Collect which @rdfjs/types symbols are actually needed
  const usedRdfTypes = new Set<string>()
  for (const { tsType } of fields) {
    if (tsType.includes('NamedNode')) usedRdfTypes.add('NamedNode')
    if (tsType.includes('BlankNode')) usedRdfTypes.add('BlankNode')
    if (tsType.includes('Literal')) usedRdfTypes.add('Literal')
    if (tsType === 'Term' || tsType.includes('| Term') || tsType.includes('Term |')) {
      usedRdfTypes.add('Term')
    }
  }
  // LiteralWithDatatype<T> is defined as Literal & { datatype: NamedNode<T> }
  if (usesLiteralWithDatatype) {
    usedRdfTypes.add('Literal')
    usedRdfTypes.add('NamedNode')
  }

  const rdfTypesImport = `import type { ${[...usedRdfTypes].sort().join(', ')} } from '@rdfjs/types'`

  // Build the @/rdf import — always needs Prettify and TypedQuery; optionally LiteralWithDatatype
  const localImports = ['Prettify', 'TypedQuery']
  if (usesLiteralWithDatatype) localImports.push('LiteralWithDatatype')
  const localImport = `import type { ${localImports.sort().join(', ')} } from '@shapething/typed-sparql'`

  const body = fields.map(({ name, tsType, optional }) => `  ${name}${optional ? '?' : ''}: ${tsType}`).join('\n')

  return `/* eslint-disable @typescript-eslint/no-unused-vars */\n${rdfTypesImport}\n${localImport}\n\ninterface QueryResult {\n${body}\n}\n\ndeclare const _default: TypedQuery<Prettify<QueryResult>>\nexport default _default\n`
}

/**
 * Processes a .rq file, generating a corresponding TypeScript declaration file.
 * @param rqPath - The path to the .rq file.
 * @param options - Options for SPARQL type generation.
 * @param parser - The SPARQL parser instance.
 */
export function processRqFile(rqPath: string, options: SparqlTypesOptions, parser: Parser): void {
  let query: string
  try {
    query = fs.readFileSync(rqPath, 'utf-8')
  } catch {
    return
  }

  let dtsContent: string | null
  try {
    dtsContent = generateDts(query, options, parser)
  } catch (e) {
    console.warn(`[sparql-types] Failed to parse ${rqPath}: ${(e as Error).message}`)
    return
  }

  if (dtsContent !== null) {
    fs.writeFileSync(`${rqPath}.d.ts`, dtsContent, 'utf-8')
  }
}

/**
 * A helper type representing an RDF literal with a specific datatype IRI. This is used to provide more precise typings for variables that are known to be literals of a certain datatype, such as those narrowed via BOUND() or identified by user-defined function return types.
 */
export type LiteralWithDatatype<TDatatype extends string> = Literal & { datatype: NamedNode<TDatatype> }

/**
 * Expands a type so that IDEs display the concrete property names instead of
 * a named alias. Useful for generated query-result interfaces.
 */
export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

// Unique symbol used as the phantom brand — prevents accidental structural matches
declare const __queryBrand: unique symbol

/**
 * A SPARQL SELECT query string that carries its result row type as a phantom
 * type parameter. At runtime this is just a plain string; the type parameter
 * is erased and only exists for TypeScript inference.
 *
 * Generated automatically by the sparql-types Vite plugin for every .rq file.
 */
export type TypedQuery<TRow extends object> = string & { readonly [__queryBrand]: TRow }
