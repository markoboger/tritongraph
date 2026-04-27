export interface IlographRelation {
  from?: string
  to?: string
  label?: string
  description?: string
  arrowDirection?: 'forward' | 'backward' | 'bidirectional'
  color?: string
  secondary?: boolean
}

export interface IlographPerspective {
  name: string
  id?: string
  relations?: IlographRelation[]
}

export interface IlographResource {
  id?: string
  name: string
  subtitle?: string
  description?: string
  children?: IlographResource[]
  [k: string]: unknown
}

export interface IlographDocument {
  title?: string
  description?: string
  resources?: IlographResource[]
  perspectives?: IlographPerspective[]
  [k: string]: unknown
}

