/**
 * Subset of https://ilograph.com/docs/spec used for sbt-style modules + dependencies.
 * Extra keys (e.g. editor) are ignored by Ilograph and may be stripped on export.
 */

export interface IlographRelation {
  from?: string
  to?: string
  via?: string
  label?: string
  description?: string
  arrowDirection?: 'forward' | 'backward' | 'bidirectional'
  color?: string
  secondary?: boolean
}

export interface IlographPerspective {
  name: string
  id?: string
  color?: string
  relations?: IlographRelation[]
  orientation?: 'leftToRight' | 'topToBottom' | 'ring'
  notes?: string
}

export interface IlographResource {
  name: string
  id?: string
  subtitle?: string
  description?: string
  color?: string
  backgroundColor?: string
  style?: 'default' | 'plural' | 'dashed' | 'outline' | 'flat'
  abstract?: boolean
  instanceOf?: string
  children?: IlographResource[]
  /** Non-standard: coordinates last saved by this editor (Ilograph ignores unknown top-level keys on resources if nested — we keep under a namespace key at doc level instead). */
}

/** Document-level extension block (not in Ilograph spec). Safe: Ilograph only documents known top-level keys; unknown keys may be preserved or dropped depending on product version — we keep minimal and prefer layout inside description or omit for strict compatibility). */
export interface IlographEditorLayout {
  /** vue-flow node id -> position */
  positions?: Record<string, { x: number; y: number }>
  /** vue-flow module node id -> CSS named accent color (see editor `boxColors` palette) */
  moduleColors?: Record<string, string>
  /** Module ids that stay visually focused (undimmed) when another container is zoomed */
  pinnedModuleIds?: string[]
}

export type IlographDocument = {
  description?: string
  defaultContextDisplayName?: string
  resources?: IlographResource[]
  perspectives?: IlographPerspective[]
  imports?: unknown[]
  contexts?: unknown[]
} & {
  /** Non-standard layout round-trip for this editor; strip before importing to Ilograph if their importer rejects unknown keys. */
  'x-triton-editor'?: IlographEditorLayout
}
