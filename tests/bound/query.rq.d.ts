import type { Literal, NamedNode } from '@rdfjs/types'
import type { LiteralWithDatatype } from '@shapething/typed-sparql'

interface QueryResult {
  hasLabel: LiteralWithDatatype<'http://www.w3.org/2001/XMLSchema#boolean'>
}
