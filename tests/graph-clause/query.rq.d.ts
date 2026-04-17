/* eslint-disable @typescript-eslint/no-unused-vars */
import type { BlankNode, NamedNode } from '@rdfjs/types'
import type { Prettify, TypedQuery } from '@shapething/typed-sparql'

interface QueryResult {
  g: NamedNode
  s: NamedNode | BlankNode
}

declare const _default: TypedQuery<Prettify<QueryResult>>
export default _default
