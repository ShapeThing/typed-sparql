/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Literal } from '@rdfjs/types'
import type { Prettify, TypedQuery } from '@shapething/typed-sparql'

interface QueryResult {
  n: Literal
}

declare const _default: TypedQuery<Prettify<QueryResult>>
export default _default
