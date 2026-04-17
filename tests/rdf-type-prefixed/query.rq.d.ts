/* eslint-disable @typescript-eslint/no-unused-vars */
import type { NamedNode } from '@rdfjs/types'
import type { Prettify, TypedQuery } from '@shapething/typed-sparql'

interface QueryResult {
  type: NamedNode
}

declare const _default: TypedQuery<Prettify<QueryResult>>
export default _default
