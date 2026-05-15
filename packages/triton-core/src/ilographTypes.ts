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
  id?: string
  name: string
  color?: string
  relations?: IlographRelation[]
  orientation?: 'leftToRight' | 'topToBottom' | 'ring'
  notes?: string
}

export interface TritonProjectCompartmentRow {
  label?: string
  value: string
}

export interface TritonProjectCompartment {
  id: string
  title: string
  rows: readonly TritonProjectCompartmentRow[]
  emptyText?: string
}

export interface IlographResource {
  id?: string
  name: string
  subtitle?: string
  description?: string
  'x-triton-project-kind'?: 'project' | 'module' | 'general'
  children?: IlographResource[]
  'x-triton-project-compartments'?: readonly TritonProjectCompartment[]
}

export interface IlographDocument {
  title?: string
  description?: string
  resources?: IlographResource[]
  perspectives?: IlographPerspective[]
}
