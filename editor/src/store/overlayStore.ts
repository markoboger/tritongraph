/**
 * In-memory **user-overlay** store backed by TinyBase.
 *
 * Why this exists
 * ---------------
 * The Ilograph YAML used to carry three completely different things:
 *   1. Structural truth scanned from the source code (resources, declarations, members,
 *      relations) — this is what the YAML *should* be, so we can diff two YAMLs and see
 *      "X added, Y removed, Z renamed" when source changes.
 *   2. Layout output from the auto-layout (`positions` map under `x-triton-editor`) — pure
 *      cache, useless for diffs.
 *   3. Per-user UI overlay: accent colors, pin state, free-form notes, inner-artefact
 *      pin/colors. Also useless for code-vs-code diffs and arguably the user's preference,
 *      not the project's data.
 *
 * Mixing all three made the YAML grow with hundreds of `x: 1234, y: 567` lines and made
 * structural diffs unreadable. This store hosts (2) and (3); the YAML is now reserved for
 * (1) only and is regenerated fresh from the scanner on every load.
 *
 * Why TinyBase
 * ------------
 * - Tabular reactive store designed for exactly this shape (one row per `(workspace, nodeId)`).
 * - Built-in listeners → trivial Vue reactivity bridge without per-cell wrappers.
 * - Optional persisters: we attach a `LocalStoragePersister` so user state survives reloads,
 *   while every "scanned" table stays purely in-memory (the scanner is the source of truth).
 * - Tiny bundle, zero deps, TypeScript-friendly.
 *
 * Scope notes
 * -----------
 * - **Per-workspace scoping**: every row's primary key is `${workspaceKey}::${nodeId}` so a
 *   single store covers all open tabs. `workspaceKey` is the `DiagramTab.key` from
 *   `App.vue` (e.g. `"sbt:scala-examples/animal-fruit"` or
 *   `"packages:scala-examples/animal-fruit"`). File uploads get a unique-suffixed key so
 *   re-opening the same file by hand starts with a clean slate.
 * - **Positions**: kept in the schema even though `<VueFlow :nodes-draggable="false">` makes
 *   the canvas non-interactive today; the slot is reserved so the day we enable drag we
 *   don't have to migrate persisted state.
 * - **Inner artefacts** are keyed by `${workspaceKey}::${nodeId}::${innerArtefactId}` because
 *   the same inner-artefact id (e.g. `"Animal"`) can recur under different parent packages.
 * - This module is intentionally **not** Vue-aware. Components consume the store via
 *   `useOverlay.ts` composables.
 */
import { createStore, type Store } from 'tinybase'
import { createLocalPersister, type LocalPersister } from 'tinybase/persisters/persister-browser'

/** localStorage key — bump the suffix when we make a breaking schema change. */
const LOCAL_STORAGE_KEY = 'triton.overlay.v1'

const TABLE_NODE_OVERLAYS = 'nodeOverlays'
const TABLE_INNER_ARTEFACT_OVERLAYS = 'innerArtefactOverlays'
/**
 * Scanner-derived snapshot of Scaladoc text, keyed by `${workspace}::${artefactId}`.
 *
 * Unlike the other tables in this store, `scalaDocs` is **not** a user overlay — its rows are
 * re-populated from the Scala source on every scan (see `App.loadScalaPackagesForExample`).
 * It still lives in the same TinyBase store so we get the same reactivity primitives
 * (listeners, composables) as the overlays; the LocalPersister will happily save stale doc
 * rows to localStorage, but they're harmless: the next scan overwrites them and rows for
 * artefacts that no longer exist are wiped via {@link clearScalaDocsForWorkspace} before the
 * repopulate step.
 *
 * We keep the Scaladoc off the YAML (see `scalaPackagesToIlograph.ts`, which deliberately
 * omits `doc` from the emitted resources) so YAML diffs stay focused on structural changes —
 * class name, kind, extends-clause, etc. Free-form prose changes every time someone fixes a
 * typo, and surfacing that as "diagram structure changed" would be misleading.
 */
const TABLE_SCALA_DOCS = 'scalaDocs'

/**
 * Scanner/import-derived `sbt test` output blocks, keyed by `${workspace}::${artefactId}`.
 *
 * This table is populated when an example contains a captured `sbt-test.log`. Like `scalaDocs`,
 * it is not user-authored overlay state: it is re-seeded per workspace on load.
 */
const TABLE_SCALA_TEST_BLOCKS = 'scalaTestBlocks'
/** Scanner/import-derived scoverage percentages, keyed by `${workspace}::${artefactId}`. */
const TABLE_SCALA_COVERAGE = 'scalaCoverage'
/**
 * Derived "which specs mention this subject" mapping, keyed by `${workspace}::${artefactId}`.
 * Populated from captured `sbt-test.log` plus a scan of `src/test/scala` for spec locations.
 */
const TABLE_SCALA_SPECS = 'scalaSpecs'

/** Visible accent palette token (`'sky'`, `'amber'`, …). Stored as-is, validated at read time. */
export type OverlayColor = string

/**
 * Row shape for `nodeOverlays`. Cells are optional: a node only gets a row once *some* user
 * state is set, and individual cells are deleted (not stored as `undefined`) when cleared so
 * the persisted JSON stays small.
 */
export interface NodeOverlayRow {
  workspace?: string
  nodeId?: string
  /** Named accent color override (`'sky'`, `'amber'`, …). Absent → fall back to scanner default. */
  color?: OverlayColor
  /** True when the user has pinned this box (sticks across other selections, drill changes). */
  pinned?: boolean
  /** Free-form user note. Distinct from the scanner's `description` field which lives in YAML. */
  notes?: string
  /** Reserved for the day `nodes-draggable` is enabled — store the user-dragged position. */
  posX?: number
  posY?: number
}

/** Row shape for `innerArtefactOverlays`. Same per-cell-optional convention as above. */
export interface InnerArtefactOverlayRow {
  workspace?: string
  nodeId?: string
  innerId?: string
  pinned?: boolean
  color?: OverlayColor
}

/**
 * Row shape for `scalaDocs`: the artefact's stripped Scaladoc text, keyed by the same
 * `artefactResourceId` used for its flow node. `doc` is always a non-empty string when the
 * row exists — we delete the row entirely when a scan produces no documentation so the read
 * side can `getRow() → {}` as its "no doc" signal without null-checks.
 */
export interface ScalaDocRow {
  workspace?: string
  nodeId?: string
  doc?: string
}

/** Row shape for `scalaTestBlocks`: console-like checklist text for one artefact. */
export interface ScalaTestBlockRow {
  workspace?: string
  nodeId?: string
  /** Suite header line as printed by sbt (e.g. `FoxSpec:`). */
  suite?: string
  /** Subject line printed by ScalaTest (e.g. `Fox` or `Fruit.Banana`). */
  subject?: string
  /** Full block text (suite + subject + `- should …` lines), newline-joined. */
  block?: string
}

export interface ScalaCoverageRow {
  workspace?: string
  nodeId?: string
  /** 0–100 statement coverage percent (scoverage statement-rate). */
  stmtPct?: number
}

export interface ScalaSpecRef {
  /** Spec class name (e.g. `FoxSpec`). */
  name: string
  /** One-line declaration string (e.g. `class FoxSpec extends AnyWordSpec`). */
  declaration: string
  /** Relative file path (within example root) to open. */
  file: string
  /** 0-indexed start row for the spec declaration. */
  startRow: number
}

export interface ScalaSpecsRow {
  workspace?: string
  nodeId?: string
  /** JSON-encoded array of {@link ScalaSpecRef}. */
  specsJson?: string
}

let storeSingleton: Store | null = null
let persisterSingleton: LocalPersister | null = null
let persisterStartPromise: Promise<void> | null = null

/**
 * Lazily create the singleton TinyBase store and start the localStorage persister.
 *
 * The persister is started *once* per page load. We keep the start promise so callers
 * (`whenOverlayStoreReady`) can `await` first-load hydration before reading values — that
 * matters for the boot sequence where `applyDoc` would otherwise race the persister and
 * apply scanner defaults before the user's last-known accent colors load.
 */
export function overlayStore(): Store {
  if (storeSingleton) return storeSingleton
  const store = createStore()
  storeSingleton = store
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      persisterSingleton = createLocalPersister(store, LOCAL_STORAGE_KEY)
      // Start auto-load (read once + listen to other tabs) and auto-save (debounced writes).
      persisterStartPromise = (async () => {
        await persisterSingleton!.startAutoLoad()
        await persisterSingleton!.startAutoSave()
      })()
    } catch {
      // localStorage unavailable (private mode, very old browser): the store still works
      // in-memory; user state simply won't persist past a reload.
      persisterSingleton = null
      persisterStartPromise = Promise.resolve()
    }
  } else {
    persisterStartPromise = Promise.resolve()
  }
  return store
}

/** Resolve once the persister has hydrated existing rows from localStorage on first call. */
export function whenOverlayStoreReady(): Promise<void> {
  overlayStore()
  return persisterStartPromise ?? Promise.resolve()
}

function nodeRowId(workspace: string, nodeId: string): string {
  return `${workspace}::${nodeId}`
}

function innerRowId(workspace: string, nodeId: string, innerId: string): string {
  return `${workspace}::${nodeId}::${innerId}`
}

/* ------------------------------------------------------------------------------------------------
 * Reads — return plain JS values; never throw on missing rows / cells.
 * ---------------------------------------------------------------------------------------------- */

export function getNodeOverlay(workspace: string, nodeId: string): NodeOverlayRow {
  const store = overlayStore()
  const row = store.getRow(TABLE_NODE_OVERLAYS, nodeRowId(workspace, nodeId)) as
    | Record<string, unknown>
    | undefined
  if (!row) return {}
  const out: NodeOverlayRow = {}
  if (typeof row.color === 'string') out.color = row.color
  if (typeof row.pinned === 'boolean') out.pinned = row.pinned
  if (typeof row.notes === 'string') out.notes = row.notes
  if (typeof row.posX === 'number') out.posX = row.posX
  if (typeof row.posY === 'number') out.posY = row.posY
  return out
}

/**
 * Return the Scaladoc for a `(workspace, nodeId)` artefact, or `''` when none was captured.
 * Pure read — does not mutate the store. Used by the `useScalaDoc` composable; components
 * that want reactivity should go through that.
 */
export function getScalaDoc(workspace: string, nodeId: string): string {
  const store = overlayStore()
  const row = store.getRow(TABLE_SCALA_DOCS, nodeRowId(workspace, nodeId)) as
    | Record<string, unknown>
    | undefined
  if (!row) return ''
  return typeof row.doc === 'string' ? row.doc : ''
}

export function getScalaTestBlock(workspace: string, nodeId: string): ScalaTestBlockRow {
  const store = overlayStore()
  const row = store.getRow(TABLE_SCALA_TEST_BLOCKS, nodeRowId(workspace, nodeId)) as
    | Record<string, unknown>
    | undefined
  if (!row) return {}
  const out: ScalaTestBlockRow = {}
  if (typeof row.suite === 'string') out.suite = row.suite
  if (typeof row.subject === 'string') out.subject = row.subject
  if (typeof row.block === 'string') out.block = row.block
  return out
}

export function getScalaCoverage(workspace: string, nodeId: string): ScalaCoverageRow {
  const store = overlayStore()
  const row = store.getRow(TABLE_SCALA_COVERAGE, nodeRowId(workspace, nodeId)) as
    | Record<string, unknown>
    | undefined
  if (!row) return {}
  const out: ScalaCoverageRow = {}
  if (typeof row.stmtPct === 'number' && Number.isFinite(row.stmtPct)) out.stmtPct = row.stmtPct
  return out
}

export function getScalaSpecs(workspace: string, nodeId: string): ScalaSpecsRow {
  const store = overlayStore()
  const row = store.getRow(TABLE_SCALA_SPECS, nodeRowId(workspace, nodeId)) as
    | Record<string, unknown>
    | undefined
  if (!row) return {}
  const out: ScalaSpecsRow = {}
  if (typeof row.specsJson === 'string') out.specsJson = row.specsJson
  return out
}

export function getInnerArtefactOverlays(
  workspace: string,
  nodeId: string,
): { pinned: Record<string, boolean>; colors: Record<string, string> } {
  const store = overlayStore()
  const all = store.getTable(TABLE_INNER_ARTEFACT_OVERLAYS) as Record<
    string,
    Record<string, unknown>
  >
  const prefix = `${workspace}::${nodeId}::`
  const pinned: Record<string, boolean> = {}
  const colors: Record<string, string> = {}
  for (const [rowId, row] of Object.entries(all)) {
    if (!rowId.startsWith(prefix)) continue
    const innerId = rowId.slice(prefix.length)
    if (row.pinned === true) pinned[innerId] = true
    if (typeof row.color === 'string') colors[innerId] = row.color
  }
  return { pinned, colors }
}

/* ------------------------------------------------------------------------------------------------
 * Writes — set/clear individual cells. We delete the row entirely once it has no meaningful
 * cells left, so the persisted JSON stays compact and never grows orphan rows.
 * ---------------------------------------------------------------------------------------------- */

export function setNodeColor(workspace: string, nodeId: string, color: OverlayColor | null): void {
  const store = overlayStore()
  const id = nodeRowId(workspace, nodeId)
  if (color == null || color === '') {
    deleteNodeCell(id, 'color')
    return
  }
  store.setCell(TABLE_NODE_OVERLAYS, id, 'workspace', workspace)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'nodeId', nodeId)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'color', color)
}

export function setNodePinned(workspace: string, nodeId: string, pinned: boolean): void {
  const store = overlayStore()
  const id = nodeRowId(workspace, nodeId)
  if (!pinned) {
    deleteNodeCell(id, 'pinned')
    return
  }
  store.setCell(TABLE_NODE_OVERLAYS, id, 'workspace', workspace)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'nodeId', nodeId)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'pinned', true)
}

export function setNodeNotes(workspace: string, nodeId: string, notes: string): void {
  const store = overlayStore()
  const id = nodeRowId(workspace, nodeId)
  if (!notes.trim()) {
    deleteNodeCell(id, 'notes')
    return
  }
  store.setCell(TABLE_NODE_OVERLAYS, id, 'workspace', workspace)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'nodeId', nodeId)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'notes', notes)
}

export function setNodePosition(
  workspace: string,
  nodeId: string,
  pos: { x: number; y: number } | null,
): void {
  const store = overlayStore()
  const id = nodeRowId(workspace, nodeId)
  if (!pos) {
    deleteNodeCell(id, 'posX')
    deleteNodeCell(id, 'posY')
    return
  }
  store.setCell(TABLE_NODE_OVERLAYS, id, 'workspace', workspace)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'nodeId', nodeId)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'posX', pos.x)
  store.setCell(TABLE_NODE_OVERLAYS, id, 'posY', pos.y)
}

/**
 * Replace the per-inner-artefact pin map for one parent node with the supplied entries (any
 * entries previously set for inner artefacts not in `map` are removed). Mirrors the shape
 * already used throughout `FlowPackageNode` so callers can pass through unchanged.
 */
/**
 * Upsert a Scaladoc row for `(workspace, nodeId)`. Empty / whitespace-only `doc` deletes the
 * row — see the "row exists → doc is non-empty" invariant on {@link ScalaDocRow}.
 */
export function setScalaDoc(workspace: string, nodeId: string, doc: string): void {
  const store = overlayStore()
  const id = nodeRowId(workspace, nodeId)
  if (!doc || !doc.trim()) {
    store.delRow(TABLE_SCALA_DOCS, id)
    return
  }
  store.setCell(TABLE_SCALA_DOCS, id, 'workspace', workspace)
  store.setCell(TABLE_SCALA_DOCS, id, 'nodeId', nodeId)
  store.setCell(TABLE_SCALA_DOCS, id, 'doc', doc)
}

/**
 * Upsert a test-output block for `(workspace, nodeId)`. Empty `block` deletes the row.
 * This mirrors the `scalaDocs` semantics: if no block exists, read side sees `{}`.
 */
export function setScalaTestBlock(
  workspace: string,
  nodeId: string,
  block: { suite: string; subject: string; blockText: string } | null,
): void {
  const store = overlayStore()
  const id = nodeRowId(workspace, nodeId)
  if (!block || !block.blockText.trim()) {
    store.delRow(TABLE_SCALA_TEST_BLOCKS, id)
    return
  }
  store.setCell(TABLE_SCALA_TEST_BLOCKS, id, 'workspace', workspace)
  store.setCell(TABLE_SCALA_TEST_BLOCKS, id, 'nodeId', nodeId)
  store.setCell(TABLE_SCALA_TEST_BLOCKS, id, 'suite', block.suite)
  store.setCell(TABLE_SCALA_TEST_BLOCKS, id, 'subject', block.subject)
  store.setCell(TABLE_SCALA_TEST_BLOCKS, id, 'block', block.blockText)
}

export function clearScalaTestBlocksForWorkspace(workspace: string): void {
  const store = overlayStore()
  const prefix = `${workspace}::`
  for (const id of store.getRowIds(TABLE_SCALA_TEST_BLOCKS)) {
    if (id.startsWith(prefix)) store.delRow(TABLE_SCALA_TEST_BLOCKS, id)
  }
}

export function setScalaCoverage(workspace: string, nodeId: string, stmtPct: number | null): void {
  const store = overlayStore()
  const id = nodeRowId(workspace, nodeId)
  if (stmtPct == null || !Number.isFinite(stmtPct)) {
    store.delRow(TABLE_SCALA_COVERAGE, id)
    return
  }
  const clamped = Math.max(0, Math.min(100, stmtPct))
  store.setCell(TABLE_SCALA_COVERAGE, id, 'workspace', workspace)
  store.setCell(TABLE_SCALA_COVERAGE, id, 'nodeId', nodeId)
  store.setCell(TABLE_SCALA_COVERAGE, id, 'stmtPct', clamped)
}

export function clearScalaCoverageForWorkspace(workspace: string): void {
  const store = overlayStore()
  const prefix = `${workspace}::`
  for (const id of store.getRowIds(TABLE_SCALA_COVERAGE)) {
    if (id.startsWith(prefix)) store.delRow(TABLE_SCALA_COVERAGE, id)
  }
}

export function setScalaSpecs(workspace: string, nodeId: string, specs: ScalaSpecRef[] | null): void {
  const store = overlayStore()
  const id = nodeRowId(workspace, nodeId)
  const meaningful = Array.isArray(specs) && specs.length > 0
  if (!meaningful) {
    store.delRow(TABLE_SCALA_SPECS, id)
    return
  }
  store.setCell(TABLE_SCALA_SPECS, id, 'workspace', workspace)
  store.setCell(TABLE_SCALA_SPECS, id, 'nodeId', nodeId)
  store.setCell(TABLE_SCALA_SPECS, id, 'specsJson', JSON.stringify(specs))
}

export function clearScalaSpecsForWorkspace(workspace: string): void {
  const store = overlayStore()
  const prefix = `${workspace}::`
  for (const id of store.getRowIds(TABLE_SCALA_SPECS)) {
    if (id.startsWith(prefix)) store.delRow(TABLE_SCALA_SPECS, id)
  }
}

/**
 * Drop every `scalaDocs` row belonging to `workspace`.
 *
 * Called before a fresh Scala scan seeds the table so artefacts that have been deleted /
 * renamed in source don't leave orphan doc rows behind. Cheaper than diffing two scans; the
 * persister's auto-save picks up the deletion in the same debounced write as the repopulate.
 */
export function clearScalaDocsForWorkspace(workspace: string): void {
  const store = overlayStore()
  const prefix = `${workspace}::`
  for (const id of store.getRowIds(TABLE_SCALA_DOCS)) {
    if (id.startsWith(prefix)) store.delRow(TABLE_SCALA_DOCS, id)
  }
}

export function setInnerArtefactPinnedMap(
  workspace: string,
  nodeId: string,
  map: Record<string, boolean>,
): void {
  syncInnerArtefactCells(workspace, nodeId, map, 'pinned')
}

export function setInnerArtefactColorsMap(
  workspace: string,
  nodeId: string,
  map: Record<string, string>,
): void {
  syncInnerArtefactCells(workspace, nodeId, map, 'color')
}

/* ------------------------------------------------------------------------------------------------
 * Bulk import — used at boot to migrate any `x-triton-editor` block found in legacy YAML into
 * the overlay store on first load, so users don't lose their existing colors/pinning when we
 * stop emitting that block to the YAML.
 * ---------------------------------------------------------------------------------------------- */

export interface LegacyEditorOverlay {
  positions?: Record<string, { x?: number; y?: number }>
  moduleColors?: Record<string, string>
  pinnedModuleIds?: readonly string[]
}

export function importLegacyEditorOverlay(workspace: string, legacy: LegacyEditorOverlay): void {
  if (!legacy) return
  if (legacy.positions) {
    for (const [id, pos] of Object.entries(legacy.positions)) {
      if (
        pos &&
        typeof pos.x === 'number' &&
        typeof pos.y === 'number' &&
        Number.isFinite(pos.x) &&
        Number.isFinite(pos.y)
      ) {
        // Only import if no position was already set — never clobber a fresher in-store value.
        const cur = getNodeOverlay(workspace, id)
        if (cur.posX === undefined && cur.posY === undefined) {
          setNodePosition(workspace, id, { x: pos.x, y: pos.y })
        }
      }
    }
  }
  if (legacy.moduleColors) {
    for (const [id, color] of Object.entries(legacy.moduleColors)) {
      if (typeof color === 'string' && color) {
        const cur = getNodeOverlay(workspace, id)
        if (cur.color === undefined) setNodeColor(workspace, id, color)
      }
    }
  }
  if (legacy.pinnedModuleIds) {
    for (const id of legacy.pinnedModuleIds) {
      if (typeof id !== 'string' || !id) continue
      const cur = getNodeOverlay(workspace, id)
      if (cur.pinned === undefined) setNodePinned(workspace, id, true)
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Subscriptions — let composables react to user writes from anywhere (e.g. a color change
 * persists immediately and any other observer of the same node sees the new value).
 * ---------------------------------------------------------------------------------------------- */

/**
 * Fires when ANY node-overlay row changes. Cheap to use; consumers filter by workspace / id
 * inside the listener. Returns an unsubscribe function so the caller can dispose on unmount.
 */
export function onNodeOverlayChanged(listener: () => void): () => void {
  const store = overlayStore()
  const lid = store.addTableListener(TABLE_NODE_OVERLAYS, () => listener())
  return () => store.delListener(lid)
}

export function onInnerArtefactOverlayChanged(listener: () => void): () => void {
  const store = overlayStore()
  const lid = store.addTableListener(TABLE_INNER_ARTEFACT_OVERLAYS, () => listener())
  return () => store.delListener(lid)
}

/**
 * Fires when ANY `scalaDocs` row changes (scan repopulate, workspace clear, …). The
 * `useScalaDoc` composable uses this to keep its reactive Ref fresh across scans.
 */
export function onScalaDocChanged(listener: () => void): () => void {
  const store = overlayStore()
  const lid = store.addTableListener(TABLE_SCALA_DOCS, () => listener())
  return () => store.delListener(lid)
}

export function onScalaTestBlockChanged(listener: () => void): () => void {
  const store = overlayStore()
  const lid = store.addTableListener(TABLE_SCALA_TEST_BLOCKS, () => listener())
  return () => store.delListener(lid)
}

export function onScalaCoverageChanged(listener: () => void): () => void {
  const store = overlayStore()
  const lid = store.addTableListener(TABLE_SCALA_COVERAGE, () => listener())
  return () => store.delListener(lid)
}

export function onScalaSpecsChanged(listener: () => void): () => void {
  const store = overlayStore()
  const lid = store.addTableListener(TABLE_SCALA_SPECS, () => listener())
  return () => store.delListener(lid)
}

/* ------------------------------------------------------------------------------------------------
 * Internal helpers
 * ---------------------------------------------------------------------------------------------- */

function deleteNodeCell(rowId: string, cell: keyof NodeOverlayRow): void {
  const store = overlayStore()
  store.delCell(TABLE_NODE_OVERLAYS, rowId, cell as string)
  // Drop the row entirely if no meaningful cells remain (workspace/nodeId are bookkeeping).
  if (rowIsEmpty(store.getRow(TABLE_NODE_OVERLAYS, rowId))) {
    store.delRow(TABLE_NODE_OVERLAYS, rowId)
  }
}

function rowIsEmpty(row: Record<string, unknown> | undefined): boolean {
  if (!row) return true
  for (const [k, v] of Object.entries(row)) {
    if (k === 'workspace' || k === 'nodeId' || k === 'innerId') continue
    if (v !== undefined && v !== null && v !== '') return false
  }
  return true
}

/**
 * Bring the inner-artefact-overlay rows into agreement with `map`: sets/updates one cell
 * (`pinned` or `color`) per entry, and removes the same cell from any row not present in
 * `map`. Other cells on the row (e.g. a color when we're updating pinned) are preserved so
 * pinning a row doesn't accidentally clear its color override.
 */
function syncInnerArtefactCells(
  workspace: string,
  nodeId: string,
  map: Record<string, boolean | string>,
  cell: 'pinned' | 'color',
): void {
  const store = overlayStore()
  const prefix = `${workspace}::${nodeId}::`
  const allRowIds = store.getRowIds(TABLE_INNER_ARTEFACT_OVERLAYS)
  const wantedInnerIds = new Set(Object.keys(map))
  for (const rowId of allRowIds) {
    if (!rowId.startsWith(prefix)) continue
    const innerId = rowId.slice(prefix.length)
    if (wantedInnerIds.has(innerId)) continue
    store.delCell(TABLE_INNER_ARTEFACT_OVERLAYS, rowId, cell)
    if (rowIsEmpty(store.getRow(TABLE_INNER_ARTEFACT_OVERLAYS, rowId))) {
      store.delRow(TABLE_INNER_ARTEFACT_OVERLAYS, rowId)
    }
  }
  for (const [innerId, value] of Object.entries(map)) {
    const id = innerRowId(workspace, nodeId, innerId)
    const meaningful =
      cell === 'pinned' ? value === true : typeof value === 'string' && value.length > 0
    if (!meaningful) {
      store.delCell(TABLE_INNER_ARTEFACT_OVERLAYS, id, cell)
      if (rowIsEmpty(store.getRow(TABLE_INNER_ARTEFACT_OVERLAYS, id))) {
        store.delRow(TABLE_INNER_ARTEFACT_OVERLAYS, id)
      }
      continue
    }
    store.setCell(TABLE_INNER_ARTEFACT_OVERLAYS, id, 'workspace', workspace)
    store.setCell(TABLE_INNER_ARTEFACT_OVERLAYS, id, 'nodeId', nodeId)
    store.setCell(TABLE_INNER_ARTEFACT_OVERLAYS, id, 'innerId', innerId)
    store.setCell(TABLE_INNER_ARTEFACT_OVERLAYS, id, cell, value)
  }
}
