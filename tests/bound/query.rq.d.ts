/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Literal, NamedNode } from '@rdfjs/types'
import type { LiteralWithDatatype, Prettify, TypedQuery } from '@shapething/typed-sparql'

interface QueryResult {
  hasLabel: LiteralWithDatatype<'http://www.w3.org/2001/XMLSchema#boolean'>
}

declare const _default: TypedQuery<Prettify<QueryResult>>
export default _default
