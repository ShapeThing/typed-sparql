import type { BlankNode, Literal, NamedNode } from '@rdfjs/types'

interface QueryResult {
  s: NamedNode | BlankNode
  label?: NamedNode | BlankNode | Literal
}
