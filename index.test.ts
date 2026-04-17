import { Parser } from '@traqula/parser-sparql-1-2'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateDts } from './index.ts'

const TESTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tests')
const parser = new Parser()

function extractInterface(dts: string): string {
  const rdfImport = dts.match(/import type \{[^}]+\} from '@rdfjs\/types'/)
  const localImport = dts.match(/import type \{[^}]+\} from '@shapething\/typed-sparql'/)
  const interfaceBlock = dts.match(/interface QueryResult \{[\s\S]*?\n\}/)
  if (!rdfImport || !interfaceBlock) return ''

  // Only include the local import line when it carries something beyond Prettify/TypedQuery
  // (i.e. LiteralWithDatatype). Extract just those extra symbols.
  let localLine: string | null = null
  if (localImport) {
    const symbols = localImport[0]
      .replace(/import type \{/, '')
      .replace(/\} from.*/, '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== 'Prettify' && s !== 'TypedQuery')
    if (symbols.length) {
      localLine = `import type { ${symbols.join(', ')} } from '@shapething/typed-sparql'`
    }
  }

  const parts = [rdfImport[0]]
  if (localLine) parts.push(localLine)
  parts.push('', interfaceBlock[0])
  return parts.join('\n')
}

const cases = fs.readdirSync(TESTS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort()

describe.each(cases)('%s', (caseName) => {
  const dir = path.join(TESTS_DIR, caseName)
  const query = fs.readFileSync(path.join(dir, 'query.rq'), 'utf-8')

  const optionsPath = path.join(dir, 'query.options.json')
  const options = fs.existsSync(optionsPath)
    ? JSON.parse(fs.readFileSync(optionsPath, 'utf-8'))
    : {}

  const expectedPath = path.join(dir, 'query.rq.d.ts')
  const expected = fs.existsSync(expectedPath)
    ? fs.readFileSync(expectedPath, 'utf-8').trim()
    : null

  it(expected !== null ? 'generates the expected QueryResult' : 'returns null', () => {
    const dts = generateDts(query, options, parser)
    if (expected === null) {
      expect(dts).toBeNull()
    } else {
      expect(extractInterface(dts!)).toBe(expected)
    }
  })
})
