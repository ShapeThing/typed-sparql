import type { BlankNode, Literal, NamedNode } from '@rdfjs/types'

interface QueryResult {
  o: NamedNode | BlankNode | Literal
}
