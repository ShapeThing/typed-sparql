import { Parser } from '@traqula/parser-sparql-1-2'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { findRqFiles, processRqFile } from './index.ts'

export interface SparqlTypesOptions {
  /**
   * Map from function IRI or prefixed name to its TypeScript return type string.
   *
   * Keys can be:
   *   - A prefixed name:  `"sta:label"`
   *   - A full IRI:       `"http://example.org/ns/label"`
   *
   * Values are TypeScript type expressions inserted verbatim, e.g.
   *   `"Literal"`, `"NamedNode"`, `"NamedNode | Literal"`.
   *
   * When a function is not listed, `Term` is used as the fallback type.
   *
   * @example
   * sparqlTypes({
   *   functions: {
   *     'sta:label': 'Literal',
   *     'sta:icon':  'Literal',
   *   },
   * })
   */
  functions?: Record<string, string>
  /**
   * Additional predicate → object TypeScript type rules, merged on top of the
   * built-in SHACL/RDF rules.
   *
   * Keys can be prefixed names or full IRIs (same format as `functions`).
   * Values are TypeScript type expressions inserted verbatim.
   *
   * @example
   * sparqlTypes({
   *   predicateObjectTypes: {
   *     'owl:sameAs': 'NamedNode',
   *   },
   * })
   */
  predicateObjectTypes?: Record<string, string>
}

export function sparqlTypes(options: SparqlTypesOptions = {}): Plugin {
  const parser = new Parser()

  return {
    name: 'sparql-types',
    enforce: 'pre',

    buildStart() {
      const srcDir = path.resolve(process.cwd(), 'src')
      for (const rqFile of findRqFiles(srcDir)) {
        processRqFile(rqFile, options, parser)
        this.addWatchFile(rqFile)
      }
    },

    load(id) {
      // Handle bare `.rq` imports (no ?raw suffix) — return the file content as
      // a default-exported string so the runtime value matches the TypedQuery<T>
      // declaration generated in the .rq.d.ts file.
      if (id.endsWith('.rq')) {
        const content = fs.readFileSync(id, 'utf-8')
        return `export default ${JSON.stringify(content)}\n`
      }
    },

    watchChange(id, { event }) {
      if (id.endsWith('.rq') && event !== 'delete') {
        processRqFile(id, options, parser)
      }
    },
  }
}
