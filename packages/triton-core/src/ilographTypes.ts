export interface IlographRelation {
  from?: string
  to?: string
  label?: string
  arrowDirection?: 'forward' | 'backward' | 'bidirectional'
}

export interface IlographPerspective {
  name: string
  color?: string
  relations?: IlographRelation[]
  orientation?: 'leftToRight' | 'topToBottom' | 'ring'
  notes?: string
}

export interface IlographResource {
  name: string
  subtitle?: string
  description?: string
  children?: IlographResource[]
}

export interface IlographDocument {
  description?: string
  resources?: IlographResource[]
  perspectives?: IlographPerspective[]
}
