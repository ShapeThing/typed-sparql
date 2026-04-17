import type { BlankNode, NamedNode } from '@rdfjs/types'

interface QueryResult {
  g: NamedNode
  s: NamedNode | BlankNode
}
