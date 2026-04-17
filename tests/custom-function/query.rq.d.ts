/* eslint-disable @typescript-eslint/no-unused-vars */
import type { NamedNode } from '@rdfjs/types'
import type { Prettify, TypedQuery } from '@shapething/typed-sparql'

interface QueryResult {
  result: NamedNode
}

declare const _default: TypedQuery<Prettify<QueryResult>>
export default _default
