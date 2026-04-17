import { Parser } from '@traqula/parser-sparql-1-2'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateDts } from './index.ts'

const TESTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tests')
const parser = new Parser()

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
    ? fs.readFileSync(expectedPath, 'utf-8')
    : null

  it(expected !== null ? 'generates the expected .d.ts' : 'returns null', () => {
    expect(generateDts(query, options, parser)).toBe(expected)
  })
})
