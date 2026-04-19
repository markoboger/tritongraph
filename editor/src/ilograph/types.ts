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

/** Nested package metadata for the Scala package view (`x-triton-inner-packages`). */
export type TritonInnerPackageSpec = {
  id: string
  name: string
  subtitle?: string
  innerPackages?: readonly TritonInnerPackageSpec[]
}

/** Scala top-level members listed inside a layer-drill–focused package box (not separate flow nodes). */
export type TritonInnerArtefactSpec = {
  id: string
  name: string
  /** Scala kind keyword (`case class`, `object`, `trait`, …). */
  subtitle?: string
}

/**
 * Inheritance-style link between two inner artefacts of the **same** package (same ids as
 * `x-triton-inner-artefacts[].id`). `label` mirrors Scala surface syntax: first parent is
 * `extends`, further mixin parents are `with`.
 */
export type TritonInnerArtefactRelationSpec = {
  from: string
  to: string
  label: 'extends' | 'with'
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
  /**
   * Non-standard editor extension: forces a specific Vue Flow `type` for this resource (overrides
   * the document-level `moduleNodeType` default). Used by the package diagram so the same document
   * can mix `package` containers and `artefact` leaves under the same parent. Stripped on YAML
   * export to keep the Ilograph document strictly conformant.
   */
  'x-triton-node-type'?: string
  /**
   * Non-standard: immediate child packages shown inside a focused root package box (not
   * separate Vue Flow nodes). Used by the Scala package view so the outer package can render
   * direct sub-packages as stacked inner cards while the outer node stays a single leaf.
   */
  'x-triton-inner-packages'?: ReadonlyArray<TritonInnerPackageSpec>
  /** Top-level Scala artefacts for this package, shown only when the package is layer-drill focused. */
  'x-triton-inner-artefacts'?: ReadonlyArray<TritonInnerArtefactSpec>
  /**
   * `extends` / `with` edges between those inner artefacts (parents → subtype), resolved only
   * for types declared in this same package so the inner diagram stays self-contained.
   */
  'x-triton-inner-artefact-relations'?: ReadonlyArray<TritonInnerArtefactRelationSpec>
  /**
   * Non-standard: this resource is the **outer Scala package scope** rendered as a Vue Flow
   * `group` — {@link GroupNode} uses it to show package-style chrome (folder + title) while
   * descendant packages are laid out inside as separate `package` nodes.
   */
  'x-triton-package-scope'?: boolean
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
