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

/**
 * A single `def` signature plus the 0-indexed source row of its declaration. Lives in both
 * the inner-artefact spec (`TritonInnerArtefactSpec.methodSignatures`) and the top-level
 * artefact resource's `x-triton-method-signatures`, which means the same shape round-trips
 * through the scanner-to-flow pipeline without translation. The row is dropped on YAML
 * export (alongside the rest of the scanner-derived fields) so the exported diagram stays
 * structural only.
 */
export interface TritonMethodSignature {
  signature: string
  /** 0-indexed — bumped to 1 when composing editor URL templates. */
  startRow: number
}

/** Scala top-level members listed inside a layer-drill–focused package box (not separate flow nodes). */
export type TritonInnerArtefactSpec = {
  id: string
  name: string
  /** Scala kind keyword (`case class`, `object`, `trait`, …). */
  subtitle?: string
  /**
   * Full one-line declaration (`"object Demo extends App"`, `"trait Animal extends Lifeform"`).
   * Rendered as the focused header subtitle instead of the kind keyword when available —
   * callers that don't parse parents simply omit this field and the box falls back to
   * `subtitle`.
   */
  declaration?: string
  /**
   * Primary constructor parameter clauses as written in source — e.g. `"(a: A, b: B)"` or
   * `"(x: X)(implicit y: Y)"`. Rendered in the focused "Arguments" panel as a Shiki code
   * block. Empty / absent for traits / objects / artefacts without a runtime parameter list;
   * the box then shows a short placeholder so the panel still has chrome.
   */
  constructorParams?: string
  /**
   * One-line signatures of `def` members for this artefact (source order, body stripped),
   * each paired with a 0-indexed source row so the focused Methods panel can open the
   * corresponding line in an external editor. Empty or absent means the panel shows a
   * `No methods` placeholder.
   *
   * Hand-edited YAML that only carries the string form (no `startRow`) is still accepted
   * on input — see the normalizer in `ilographToFlow.ts`, which falls back to row `0`
   * (points at the file top) so the click target degrades to "open file" rather than
   * failing silently.
   */
  methodSignatures?: ReadonlyArray<TritonMethodSignature>
  /**
   * Source file this artefact is declared in, relative to its `(root, exampleDir)`
   * — same format as {@link ScalaArtefact.file}. Used by the "open in editor" click
   * handler to resolve an absolute path.
   */
  sourceFile?: string
  /**
   * 0-indexed tree-sitter source row for the declaration start. The open-in-editor
   * action adds `+1` when emitting 1-indexed URL-scheme templates. Absent when the
   * scanner can't supply a location.
   */
  sourceRow?: number
}

/**
 * Structural link between two inner artefacts of the **same** package (same ids as
 * `x-triton-inner-artefacts[].id`). `label` is one of:
 *
 *   - `extends` — first parent of a class / trait / object (Scala `extends` keyword).
 *   - `with`    — stacked mixin parent (Scala `with` keyword), rendered as *has trait*.
 *   - `uses`    — the `from` artefact's primary constructor takes the `to` artefact as a
 *                 parameter, directly or through a generic wrapper like `Option[X]`. See
 *                 {@link ScalaUsesEdge} in `scalaPackagesToIlograph.ts` for the full resolution
 *                 rules. Does NOT contribute to column layering (parents still left, children
 *                 still right); it's an overlay on the inheritance layout.
 */
export type TritonInnerArtefactRelationSpec = {
  from: string
  to: string
  label: 'extends' | 'with' | 'uses'
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
  /**
   * Non-standard: detected source language for the top-level package scope (`scala`, `java`,
   * `kotlin`, `typescript`, `python`, …). Inferred from file path convention (`src/main/<lang>/`)
   * or file extension. Surfaced only on `x-triton-package-scope: true` resources so {@link GroupNode}
   * can show a single language logo on the topmost package; nested sub-packages inherit it and
   * don't re-display.
   */
  'x-triton-package-language'?: string
  /**
   * Non-standard: full one-line declaration for a Scala artefact leaf — `"object Demo extends App"`,
   * `"trait Animal extends Lifeform with Named"`. Set by {@link buildScalaPackageGraph} only on
   * `artefact` resources; read by {@link ilographToFlow} → `data.declaration` and rendered as the
   * focused header subtitle (falling back to `subtitle` / kind when absent).
   */
  'x-triton-declaration'?: string
  /**
   * Non-standard: primary constructor parameter source text for an `artefact` resource
   * (e.g. `"(a: A, b: B)"`). Populated by {@link buildScalaPackageGraph}; surfaced on the
   * focused "Arguments" panel via `data.constructorParams`. Stripped on YAML export to keep
   * Ilograph output conformant.
   */
  'x-triton-constructor-params'?: string
  /**
   * Non-standard: one-line signatures of `def` members for an `artefact` resource — same shape
   * as {@link TritonInnerArtefactSpec.methodSignatures}. Populated by
   * {@link buildScalaPackageGraph} from tree-sitter output; surfaced on the focused Methods panel
   * via `data.methodSignatures`. Stripped on YAML export to keep Ilograph output conformant.
   */
  'x-triton-method-signatures'?: ReadonlyArray<TritonMethodSignature>
  /**
   * Non-standard: source file (relative to `(root, exampleDir)`) for an `artefact` leaf — used
   * by the open-in-editor click handler in combination with `x-triton-source-row`. Mirrors the
   * inner-artefact form {@link TritonInnerArtefactSpec.sourceFile}.
   */
  'x-triton-source-file'?: string
  /** Non-standard: 0-indexed start row of the declaration. See {@link TritonInnerArtefactSpec.sourceRow}. */
  'x-triton-source-row'?: number
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
