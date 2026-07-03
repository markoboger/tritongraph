/**
 * Target (Soll) architecture editor session: one per repository workspace, shared by every editor
 * tab (root package graph + every drilled scope) so edits made at any depth land in the same model.
 *
 * Design: the session holds the as-is ("Ist") `CodeModel` plus a flat `TargetEditOps` overlay.
 * `applyTargetOps` is a pure function that projects `(base, ops)` into the Soll `CodeModel` — a
 * first-class CodeModel, so every existing projection/drill/diff helper in `codeModelToIlograph.ts`
 * works on it unchanged. Edits are captured by `reconcileScope`, which diffs what the user left on
 * the canvas for one scope against what the session would currently project there, and folds the
 * difference back into `ops`. Callers reconcile at well-defined sync points (tab switch, drill,
 * save) — see `App.vue`.
 */
import type {
  CodeArtefact,
  CodeContainer,
  CodeModel,
  CodeRelation,
} from '../../../packages/triton-core/src/languageModel'
import type { IlographDocument } from '../../../packages/triton-core/src/ilographTypes'
import {
  codeModelToFullExportDocument,
  collapseSingleChild,
  findContainer,
  rollupImportRelations,
} from '../../../packages/triton-core/src/codeModelToIlograph'

export interface EdgePair {
  from: string
  to: string
}

export interface AddedContainer {
  id: string
  name: string
  parentId: string
  memberIds: string[]
}

export interface TargetEditOps {
  /** Ist import relations covered by (from-subtree -> to-subtree) are dropped from the Soll. */
  removedImports: EdgePair[]
  /** Extra allowed edges, as the exact container-id pair drawn. */
  addedImports: EdgePair[]
  /** New abstraction/grouping containers (or plain new leaf nodes with no members). */
  addedContainers: AddedContainer[]
  /** Container id -> new display name. Ids stay stable so relations keep resolving. */
  renames: Record<string, string>
  /** Container ids removed from the target (whole subtree). */
  deletedNodes: string[]
  /** Scope ids (root = `''`) whose child level has been edited — used to pick component granularity on save. */
  editedScopes: string[]
}

export interface TargetEditSession {
  workspacePath: string
  workspaceName: string
  /** The as-is model, re-derived from the current code each time the editor is opened for this repo. */
  baseModel: CodeModel
  ops: TargetEditOps
  dirty: boolean
}

/** Minimal shape `reconcileScope`/`sollDiffForScope` need from a rendered flow node. Framework-agnostic on purpose. */
export interface ReconcileNode {
  id: string
  label?: string
}

/** Minimal shape for a rendered flow edge. Callers must exclude ghost/overlay-only edges before calling. */
export interface ReconcileEdge {
  source: string
  target: string
}

export type SollDiffStatus = 'added' | 'modified'

export interface SollDiff {
  statusById: Record<string, SollDiffStatus>
  importDiff: { added: Set<string>; removed: EdgePair[] }
}

function emptyOps(): TargetEditOps {
  return { removedImports: [], addedImports: [], addedContainers: [], renames: {}, deletedNodes: [], editedScopes: [] }
}

const sessions = new Map<string, TargetEditSession>()

/** One session per workspace, reused across every editor tab opened for that repository. */
export function getOrCreateSession(
  workspacePath: string,
  workspaceName: string,
  baseModel: CodeModel,
): TargetEditSession {
  const existing = sessions.get(workspacePath)
  if (existing) return existing
  const session: TargetEditSession = { workspacePath, workspaceName, baseModel, ops: emptyOps(), dirty: false }
  sessions.set(workspacePath, session)
  return session
}

/** Look up an already-open session without creating one — used by reconcile/save call sites that only act if a session exists. */
export function peekSession(workspacePath: string): TargetEditSession | null {
  return sessions.get(workspacePath) ?? null
}

/** Replace a session's ops wholesale — used when seeding from the checker's derive/load mode or a saved target. */
export function seedSessionOps(session: TargetEditSession, ops: TargetEditOps): void {
  session.ops = ops
  session.dirty = false
}

// ── applyTargetOps: project (base, ops) into the Soll CodeModel ─────────────────────────────────

/** Mutable working copy of a CodeContainer subtree — `applyTargetOps` clones once, then mutates in place. */
interface MutableContainer {
  id: string
  name: string
  kind: CodeContainer['kind']
  language: CodeContainer['language']
  source?: CodeContainer['source']
  children: MutableContainer[]
  artefacts: readonly CodeArtefact[]
}

function cloneContainer(container: CodeContainer): MutableContainer {
  return { ...container, children: container.children.map(cloneContainer) }
}

function findMutableContainer(root: MutableContainer, id: string): MutableContainer | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const hit = findMutableContainer(child, id)
    if (hit) return hit
  }
  return null
}

/** Detach `id` from wherever it currently sits in the tree and return it, or null if not found. */
function detachContainer(root: MutableContainer, id: string): MutableContainer | null {
  const idx = root.children.findIndex((c) => c.id === id)
  if (idx >= 0) return root.children.splice(idx, 1)[0] ?? null
  for (const child of root.children) {
    const hit = detachContainer(child, id)
    if (hit) return hit
  }
  return null
}

function deleteContainerIds(root: MutableContainer, deletedIds: ReadonlySet<string>): void {
  if (deletedIds.size === 0) return
  root.children = root.children.filter((c) => !deletedIds.has(c.id))
  for (const child of root.children) deleteContainerIds(child, deletedIds)
}

function applyRenamesInPlace(root: MutableContainer, renames: Readonly<Record<string, string>>): void {
  const rename = renames[root.id]
  if (rename !== undefined) root.name = rename
  for (const child of root.children) applyRenamesInPlace(child, renames)
}

function insertAddedContainers(
  root: MutableContainer,
  language: CodeContainer['language'],
  addedContainers: readonly AddedContainer[],
): void {
  for (const spec of addedContainers) {
    if (findMutableContainer(root, spec.id)) continue // already inserted (idempotent re-apply)
    const members = spec.memberIds
      .map((id) => detachContainer(root, id))
      .filter((c): c is MutableContainer => c !== null)
    const parent = findMutableContainer(root, spec.parentId) ?? root
    parent.children.push({
      id: spec.id,
      name: spec.name,
      kind: 'package',
      language,
      children: members,
      artefacts: [],
    })
  }
}

function buildAncestryIndex(root: MutableContainer): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const visit = (node: MutableContainer, ancestors: readonly string[]): void => {
    const chain = new Set(ancestors)
    chain.add(node.id)
    index.set(node.id, chain)
    for (const child of node.children) visit(child, [...ancestors, node.id])
  }
  visit(root, [])
  return index
}

function isInSubtree(ancestry: Map<string, Set<string>>, containerId: string, subtreeRootId: string): boolean {
  return ancestry.get(containerId)?.has(subtreeRootId) ?? containerId === subtreeRootId
}

/** Mirrors the private `endpointContainerId` in codeModelToIlograph.ts — not exported there for one caller. */
function endpointContainerId(id: string): string {
  const sep = id.indexOf('::')
  return sep >= 0 ? id.slice(0, sep) : id
}

function buildTargetRelations(
  baseRelations: readonly CodeRelation[],
  ops: TargetEditOps,
  ancestry: Map<string, Set<string>>,
): CodeRelation[] {
  const kept = baseRelations.filter((rel) => {
    const from = endpointContainerId(rel.from)
    const to = endpointContainerId(rel.to)
    if (!ancestry.has(from) || !ancestry.has(to)) return false // endpoint's container was deleted
    if (rel.kind !== 'imports') return true
    return !ops.removedImports.some(
      (pair) => isInSubtree(ancestry, from, pair.from) && isInSubtree(ancestry, to, pair.to),
    )
  })
  const synthetic: CodeRelation[] = ops.addedImports.map((pair) => ({
    id: `target-added-import:${pair.from}->${pair.to}`,
    from: pair.from,
    to: pair.to,
    kind: 'imports',
    scope: 'container',
  }))
  return [...kept, ...synthetic]
}

/** Project the as-is model through the edit ops into the target ("Soll") CodeModel. Pure. */
export function applyTargetOps(base: CodeModel, ops: TargetEditOps): CodeModel {
  const root = cloneContainer(base.root)
  deleteContainerIds(root, new Set(ops.deletedNodes))
  applyRenamesInPlace(root, ops.renames)
  insertAddedContainers(root, base.language, ops.addedContainers)
  const ancestry = buildAncestryIndex(root)
  const relations = buildTargetRelations(base.relations, ops, ancestry)
  return { ...base, root, relations }
}

// ── reconcileScope: fold the visible diagram for one scope back into the session ────────────────

/**
 * Diff what the user left on the canvas for one rendered scope against what the session currently
 * projects there, and fold the difference into `session.ops`. The single mutation entry point for
 * the target edit session — called at tab-switch/drill/save sync points, never on every keystroke.
 *
 * TODO(undo/redo): this is where an undo/redo stack should snapshot `session.ops` before and after.
 */
/**
 * Re-derive this scope's edge ops from the canvas. Prior ops touching the scope's children are
 * dropped first so repeated reconciles stay minimal instead of accumulating stale entries. The
 * baseline is the untouched base model's relations (not the soll's, which already has this scope's
 * own prior ops folded in — re-reconciling against that self-referential baseline would silently
 * drop ops that were never un-done on the canvas). `scope.children` still comes from the soll, so
 * grouping/renames at this scope are respected.
 */
function reconcileEdgeOps(
  session: TargetEditSession,
  scope: CodeContainer,
  visibleEdges: readonly ReconcileEdge[],
): Pick<TargetEditOps, 'removedImports' | 'addedImports'> {
  const childIds = new Set(scope.children.map((c) => c.id))
  const touchesScope = (pair: EdgePair): boolean => childIds.has(pair.from) || childIds.has(pair.to)
  const removedImports = session.ops.removedImports.filter((p) => !touchesScope(p))
  const addedImports = session.ops.addedImports.filter((p) => !touchesScope(p))

  const baselineKeys = new Set(
    rollupImportRelations(session.baseModel.relations, scope.children).map((e) => `${e.from}->${e.to}`),
  )
  const visibleKeys = new Set(visibleEdges.map((e) => `${e.source}->${e.target}`))
  const pairOf = (key: string): EdgePair => {
    const arrow = key.indexOf('->')
    return { from: key.slice(0, arrow), to: key.slice(arrow + 2) }
  }
  for (const key of visibleKeys) {
    if (!baselineKeys.has(key)) addedImports.push(pairOf(key))
  }
  for (const key of baselineKeys) {
    if (!visibleKeys.has(key)) removedImports.push(pairOf(key))
  }
  return { removedImports, addedImports }
}

/** Missing children → deletions; unknown pane-drop nodes → additions; label mismatches → renames. */
function reconcileNodeOps(
  session: TargetEditSession,
  scope: CodeContainer,
  visibleNodes: readonly ReconcileNode[],
): Pick<TargetEditOps, 'deletedNodes' | 'addedContainers' | 'renames'> {
  const visibleIds = new Set(visibleNodes.map((n) => n.id))
  const deletedNodes = [...session.ops.deletedNodes]
  const addedContainers = [...session.ops.addedContainers]
  const renames = { ...session.ops.renames }

  for (const child of scope.children) {
    if (!visibleIds.has(child.id)) deletedNodes.push(child.id)
  }
  for (const node of visibleNodes) {
    const existing = scope.children.find((c) => c.id === node.id)
    if (existing) {
      if (typeof node.label === 'string' && node.label !== existing.name) renames[node.id] = node.label
      continue
    }
    if (!node.id.startsWith('module-')) continue // only pane-drop nodes are "new" at reconcile time
    addedContainers.push({ id: node.id, name: node.label ?? node.id, parentId: scope.id, memberIds: [] })
  }
  return { deletedNodes: [...new Set(deletedNodes)], addedContainers, renames }
}

export function reconcileScope(
  session: TargetEditSession,
  scopeId: string | undefined,
  visibleNodes: readonly ReconcileNode[],
  visibleEdges: readonly ReconcileEdge[],
): void {
  const soll = applyTargetOps(session.baseModel, session.ops)
  const rawScope = scopeId ? findContainer(soll.root, scopeId) : soll.root
  if (!rawScope) return
  const scope = collapseSingleChild(rawScope)
  if (scope.children.length === 0) return // leaf (class) scope — out of MVP scope

  // The canonical scope identity is the *collapsed* container's own id, not the navigational
  // `scopeId` (undefined/root collapses through single-child wrapper packages, e.g. straight to
  // `shop` for a repo with one top-level package) — using the real id keeps `addedContainers`
  // parenting and `editedScopes` correct even after the tree is later restructured by grouping.
  const scopeKey = scope.id
  const next: TargetEditOps = {
    ...reconcileEdgeOps(session, scope, visibleEdges),
    ...reconcileNodeOps(session, scope, visibleNodes),
    editedScopes: session.ops.editedScopes.includes(scopeKey)
      ? session.ops.editedScopes
      : [...session.ops.editedScopes, scopeKey],
  }
  // View-only reconciles (tab switch without any canvas edit) must not touch the session: they
  // would mark it dirty and record the viewed scope into editedScopes, changing the component
  // granularity of the saved target just by looking at a tab.
  if (JSON.stringify({ ...next, editedScopes: [] }) === JSON.stringify({ ...session.ops, editedScopes: [] })) return
  session.ops = next
  session.dirty = true
}

/**
 * The container id actually rendered for `scopeId` (root when undefined) after collapsing
 * single-child wrapper packages — the canonical scope identity for ops bookkeeping. Callers that
 * add a container at a scope (e.g. grouping) must resolve this first; `reconcileScope` does so
 * internally for edits captured off the canvas.
 */
export function resolveScopeContainerId(session: TargetEditSession, scopeId: string | undefined): string {
  const soll = applyTargetOps(session.baseModel, session.ops)
  const raw = scopeId ? findContainer(soll.root, scopeId) : soll.root
  return collapseSingleChild(raw ?? soll.root).id
}

/** Group `memberIds` (direct children of `parentId`, an already-resolved scope id) under a brand-new container. Call `reconcileScope` first. */
export function groupIntoAbstraction(
  session: TargetEditSession,
  parentId: string,
  groupId: string,
  groupName: string,
  memberIds: readonly string[],
): void {
  session.ops = {
    ...session.ops,
    addedContainers: [
      ...session.ops.addedContainers,
      { id: groupId, name: groupName, parentId, memberIds: [...memberIds] },
    ],
  }
  session.dirty = true
}

// ── Ist/Soll diff for the overlay ────────────────────────────────────────────────────────────────

/** Added/renamed boxes and added/removed edges for one scope, base vs. current session ops. */
export function sollDiffForScope(session: TargetEditSession, scopeId: string | undefined): SollDiff {
  const empty: SollDiff = { statusById: {}, importDiff: { added: new Set(), removed: [] } }
  const soll = applyTargetOps(session.baseModel, session.ops)
  const rawBaseScope = scopeId ? findContainer(session.baseModel.root, scopeId) : session.baseModel.root
  const rawSollScope = scopeId ? findContainer(soll.root, scopeId) : soll.root
  if (!rawBaseScope || !rawSollScope) return empty
  const baseScope = collapseSingleChild(rawBaseScope)
  const sollScope = collapseSingleChild(rawSollScope)

  const baseKeys = new Set(
    rollupImportRelations(session.baseModel.relations, baseScope.children).map((e) => `${e.from}->${e.to}`),
  )
  const sollKeys = new Set(rollupImportRelations(soll.relations, sollScope.children).map((e) => `${e.from}->${e.to}`))

  const added = new Set<string>()
  for (const key of sollKeys) if (!baseKeys.has(key)) added.add(key)
  const removed: EdgePair[] = []
  for (const key of baseKeys) {
    if (sollKeys.has(key)) continue
    const [from, to] = key.split('->')
    removed.push({ from: from!, to: to! })
  }

  const statusById: Record<string, SollDiffStatus> = {}
  const baseChildIds = new Set(baseScope.children.map((c) => c.id))
  for (const child of sollScope.children) {
    if (!baseChildIds.has(child.id)) statusById[child.id] = 'added'
    else if (session.ops.renames[child.id] !== undefined) statusById[child.id] = 'modified'
  }
  return { statusById, importDiff: { added, removed } }
}

// ── Serialize the Soll to Ilograph YAML for the checker + persistence ───────────────────────────

function buildComponentIndex(root: CodeContainer, componentIds: ReadonlySet<string>): Map<string, string> {
  const index = new Map<string, string>()
  const visit = (node: CodeContainer, currentComponent: string | null): void => {
    const component = componentIds.has(node.id) ? node.id : currentComponent
    if (component) index.set(node.id, component)
    for (const child of node.children) visit(child, component)
  }
  visit(root, null)
  return index
}

/**
 * Serialize the session to an Ilograph document: slim resources for the whole Soll tree, one
 * `target-architecture` perspective with component-level allowed edges (components = the union of
 * every edited scope's children, innermost-wins when scopes nest), plus the raw ops so re-opening
 * the editor restores exact state. `resolveTopology` (triton-conformance) consumes this directly.
 */
export function serializeTargetDocument(session: TargetEditSession): Record<string, unknown> {
  const soll = applyTargetOps(session.baseModel, session.ops)
  const scopeIds = session.ops.editedScopes.length ? session.ops.editedScopes : ['']
  const components = new Set<string>()
  for (const scopeId of scopeIds) {
    const container = scopeId ? findContainer(soll.root, scopeId) : soll.root
    if (!container) continue
    for (const child of collapseSingleChild(container).children) components.add(child.id)
  }
  const componentOfContainer = buildComponentIndex(soll.root, components)

  const allowedEdges: EdgePair[] = []
  const seen = new Set<string>()
  for (const rel of soll.relations) {
    if (rel.kind !== 'imports') continue
    const from = componentOfContainer.get(endpointContainerId(rel.from))
    const to = componentOfContainer.get(endpointContainerId(rel.to))
    if (!from || !to || from === to) continue
    const key = `${from}->${to}`
    if (seen.has(key)) continue
    seen.add(key)
    allowedEdges.push({ from, to })
  }

  const exportDoc = codeModelToFullExportDocument(soll, {
    detail: 'slim',
    description: `Target architecture (Soll) for ${session.workspaceName}. Edited with the Triton target editor.`,
  })

  return {
    description: exportDoc.description,
    resources: exportDoc.resources,
    perspectives: [{ name: 'target-architecture', relations: allowedEdges }],
    'x-triton-target-ops': session.ops,
  }
}

// ── Seeding ops from the checker's current topology mode ────────────────────────────────────────

/** Restore ops from a previously-saved target document's `x-triton-target-ops` block, if present. */
export function opsFromTargetYaml(doc: IlographDocument): TargetEditOps | null {
  const raw = (doc as Record<string, unknown>)['x-triton-target-ops']
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<TargetEditOps>
  return {
    removedImports: Array.isArray(r.removedImports) ? r.removedImports : [],
    addedImports: Array.isArray(r.addedImports) ? r.addedImports : [],
    addedContainers: Array.isArray(r.addedContainers) ? r.addedContainers : [],
    renames: r.renames && typeof r.renames === 'object' ? r.renames : {},
    deletedNodes: Array.isArray(r.deletedNodes) ? r.deletedNodes : [],
    editedScopes: Array.isArray(r.editedScopes) ? r.editedScopes : [],
  }
}

/** Scopes whose children are exactly `depth` dotted segments deep — mirrors `deriveTopologyFromCodeModel`. */
function editedScopesForComponentDepth(root: CodeContainer, depth: number): string[] {
  const scopes = new Set<string>()
  const visit = (node: CodeContainer, parentId: string | undefined, segments: number): void => {
    if (segments === depth) {
      scopes.add(parentId ?? '')
      return
    }
    for (const child of node.children) visit(child, node.id, segments + 1)
  }
  for (const child of root.children) visit(child, undefined, 1)
  return [...scopes]
}

/** Seed ops from the checker's "derive from project" mode: disabled edges become forbidden (removed). */
export function opsFromDerivedSeed(
  seed: { disabledEdges: readonly string[]; componentDepth: number },
  base: CodeModel,
): TargetEditOps {
  const ops = emptyOps()
  for (const key of seed.disabledEdges) {
    const arrow = key.indexOf('->')
    if (arrow < 0) continue
    ops.removedImports.push({ from: key.slice(0, arrow), to: key.slice(arrow + 2) })
  }
  ops.editedScopes = editedScopesForComponentDepth(base.root, Math.max(1, seed.componentDepth))
  return ops
}

/**
 * Seed ops from a pasted ilograph.yaml with no `x-triton-target-ops` block: compare its relations
 * against the base model's root-level rollup and express the difference as edge ops.
 *
 * ponytail: root-level edges only — any custom resource nesting/renames in the pasted YAML is
 * ignored. Upgrade to a full tree diff if pasted YAML becomes a common editor entry point.
 */
export function opsFromForeignYamlEdgeDiff(doc: IlographDocument, base: CodeModel): TargetEditOps {
  const ops = emptyOps()
  const relations = (doc.perspectives ?? []).flatMap((p) => p.relations ?? [])
  const desired = new Set<string>()
  for (const rel of relations) {
    if (!rel.from || !rel.to) continue
    desired.add(`${rel.from}->${rel.to}`)
  }
  const baseline = rollupImportRelations(base.relations, collapseSingleChild(base.root).children)
  const baselineKeys = new Set(baseline.map((e) => `${e.from}->${e.to}`))
  for (const key of desired) {
    if (baselineKeys.has(key)) continue
    const [from, to] = key.split('->')
    ops.addedImports.push({ from: from!, to: to! })
  }
  for (const e of baseline) {
    const key = `${e.from}->${e.to}`
    if (desired.has(key)) continue
    ops.removedImports.push({ from: e.from, to: e.to })
  }
  ops.editedScopes = ['']
  return ops
}
