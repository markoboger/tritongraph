import { computed, inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import { MarkerType } from '@vue-flow/core'
import type { CodeContainer, CodeModel } from '../../../packages/triton-core/src/languageModel'
import { AGG_SOURCE_HANDLE, AGG_TARGET_HANDLE } from './handles'

/** How a box changed since the diff base. `unchanged` drives the grey wash the other states sit against. */
export type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged'

/** Lines added/removed for one file, from `git diff --numstat`. */
export interface FileChurn {
  added: number
  removed: number
}

/** Workspace-relative file path → its churn. Keys match `SourceLocation.file` (git runs with `--relative`). */
export type ChurnByFile = Record<string, FileChurn>

/** Grey for unchanged, green added, red removed, amber both. Feeds `--box-accent` (strip + derived wash). */
export const diffStatusColor: Record<DiffStatus, string> = {
  added: '#16a34a',
  removed: '#dc2626',
  modified: '#d97706',
  unchanged: '#94a3b8',
}

function classify(added: number, removed: number): DiffStatus {
  if (added > 0 && removed > 0) return 'modified'
  if (added > 0) return 'added'
  if (removed > 0) return 'removed'
  return 'unchanged'
}

/**
 * Classify every container and artefact node (keyed by its flow-node id) from per-file churn.
 * A container aggregates the churn of every file in its subtree, so a package is `modified` when
 * any child changed. Leaves take their own file's churn. Fully deleted files have no node here.
 */
export function diffStatusByNode(model: CodeModel, churn: ChurnByFile): Record<string, DiffStatus> {
  const out: Record<string, DiffStatus> = {}
  walk(model.root, churn, out)
  return out
}

function walk(container: CodeContainer, churn: ChurnByFile, out: Record<string, DiffStatus>): FileChurn {
  let added = 0
  let removed = 0
  if (container.source?.file) {
    const c = churn[container.source.file]
    if (c) {
      added += c.added
      removed += c.removed
    }
  }
  for (const artefact of container.artefacts) {
    const c = churn[artefact.source.file]
    const a = c?.added ?? 0
    const r = c?.removed ?? 0
    added += a
    removed += r
    out[artefact.id] = classify(a, r)
  }
  for (const child of container.children) {
    const sub = walk(child, churn, out)
    added += sub.added
    removed += sub.removed
  }
  out[container.id] = classify(added, removed)
  return { added, removed }
}

// --- Phase 2: import/edge diff ------------------------------------------------

/** Added import edges tint green; removed ones become dashed-red ghost lines. */
export const ADDED_EDGE_COLOR = '#16a34a'
export const REMOVED_EDGE_COLOR = '#dc2626'
export const UNCHANGED_EDGE_COLOR = '#94a3b8'
export const GHOST_EDGE_ID_PREFIX = 'gitdiff-ghost:'

/** Container-import changes between two revisions. Keys are `${fromModule}->${toModule}`. */
export interface ImportDiff {
  added: Set<string>
  removed: { from: string; to: string }[]
}

export function importEdgeKey(from: string, to: string): string {
  return `${from}->${to}`
}

/** Container-level import edges of a model, keyed. Mirrors `observedImportsFromCodeModel` (triton-conformance). */
function containerImportKeys(model: CodeModel): Set<string> {
  const out = new Set<string>()
  for (const r of model.relations) {
    if (r.kind === 'imports' && r.scope === 'container') out.add(importEdgeKey(r.from, r.to))
  }
  return out
}

/** Container imports of both revisions. Module-level; rolled up to the visible boxes on demand. */
export interface ImportEdgeSets {
  base: Set<string>
  current: Set<string>
}

export function emptyImportEdgeSets(): ImportEdgeSets {
  return { base: new Set(), current: new Set() }
}

export function importEdgeSetsFromModels(base: CodeModel, current: CodeModel): ImportEdgeSets {
  return { base: containerImportKeys(base), current: containerImportKeys(current) }
}

/**
 * Diff the imports between the boxes on the canvas: each module import counts for the nearest box
 * that contains it. An edge is `added` when the base had no import between those two boxes at all,
 * `removed` when the current revision has none left — one more import between already connected
 * boxes changes nothing. Imports inside one box, or from/to modules with no box, are ignored.
 */
export function importDiffAtVisibleLevel(edges: ImportEdgeSets, visibleIds: ReadonlySet<string>): ImportDiff {
  const base = rollUpImportKeys(edges.base, visibleIds)
  const current = rollUpImportKeys(edges.current, visibleIds)
  const added = new Set<string>()
  for (const k of current) if (!base.has(k)) added.add(k)
  const removed: { from: string; to: string }[] = []
  for (const k of base) {
    if (current.has(k)) continue
    const [from, to] = k.split('->')
    removed.push({ from, to })
  }
  return { added, removed }
}

function rollUpImportKeys(keys: ReadonlySet<string>, visibleIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const k of keys) {
    const [from, to] = k.split('->')
    const fromBox = visibleBoxOf(from, visibleIds)
    const toBox = visibleBoxOf(to, visibleIds)
    if (fromBox && toBox && fromBox !== toBox) out.add(importEdgeKey(fromBox, toBox))
  }
  return out
}

/**
 * True when the head imports from anywhere inside `fromScope` into anywhere inside `toScope` and the
 * base did not — e.g. a box that newly reaches into one tile of another box.
 */
export function importIsNewBetween(edges: ImportEdgeSets, fromScope: string, toScope: string): boolean {
  return reachesBetween(edges.current, fromScope, toScope) && !reachesBetween(edges.base, fromScope, toScope)
}

/** True when the base imported from anywhere inside `fromScope` into anywhere inside `toScope` and the head no longer does. */
export function importIsRemovedBetween(edges: ImportEdgeSets, fromScope: string, toScope: string): boolean {
  return reachesBetween(edges.base, fromScope, toScope) && !reachesBetween(edges.current, fromScope, toScope)
}

function reachesBetween(keys: ReadonlySet<string>, fromScope: string, toScope: string): boolean {
  return [...keys].some((k) => {
    const [from, to] = k.split('->')
    return isInside(from, fromScope) && isInside(to, toScope)
  })
}

function isInside(id: string, scope: string): boolean {
  return id === scope || id.startsWith(`${scope}.`) || id.startsWith(`${scope}/`)
}

/** The module itself if it is on the canvas, else its nearest visible ancestor (`a.b.c` → `a.b` → `a`). */
function visibleBoxOf(moduleId: string, visibleIds: ReadonlySet<string>): string | null {
  let id = moduleId
  while (id) {
    if (visibleIds.has(id)) return id
    id = id.slice(0, Math.max(id.lastIndexOf('.'), id.lastIndexOf('/'), 0))
  }
  return null
}

export function isGhostEdge(edgeId: string | undefined): boolean {
  return !!edgeId?.startsWith(GHOST_EDGE_ID_PREFIX)
}

/**
 * A dashed-red "ghost" edge for a removed import — the dependency no longer exists in the current
 * graph, so it is synthesised on top.
 *
 * ponytail: ghost edges are plain straight lines with no lane routing (a removed import has no
 * layout track to route along). Upgrade to routed ghosts only if they read poorly on dense graphs.
 */
export function makeGhostImportEdge(from: string, to: string) {
  // No TritonFlowEdge annotation on purpose: vue-flow's Edge generic is deep enough to blow the
  // instantiation limit when this flows through `.map`/spread. The caller casts the final array.
  return {
    id: `${GHOST_EDGE_ID_PREFIX}${importEdgeKey(from, to)}`,
    source: from,
    target: to,
    sourceHandle: AGG_SOURCE_HANDLE,
    targetHandle: AGG_TARGET_HANDLE,
    label: 'removed import',
    labelStyle: { fill: REMOVED_EDGE_COLOR, fontSize: '11px', fontWeight: 600 },
    style: { stroke: REMOVED_EDGE_COLOR, strokeWidth: 2, strokeDasharray: '6 4' },
    markerEnd: { type: MarkerType.ArrowClosed, color: REMOVED_EDGE_COLOR, width: 14, height: 14 },
    data: { gitDiffGhost: true },
  }
}

/** Provided by App.vue, injected by the box + edge components. Toggling `visible` drives the overlay. */
export interface GitDiffContext {
  visible: Ref<boolean>
  statusById: Ref<Record<string, DiffStatus>>
  importDiff: Ref<ImportDiff>
  /** Is the import from box `fromScope` into tile `toScope` new? Git diff only; absent for the Ist/Soll diff. */
  isNewImportInto?: (fromScope: string, toScope: string) => boolean
  /** Did box `fromScope` import into tile `toScope` at the diff base, but no longer? Git diff only. */
  isRemovedImportInto?: (fromScope: string, toScope: string) => boolean
}

export const gitDiffKey = Symbol('tritonGitDiff') as InjectionKey<GitDiffContext>

/**
 * A box's diff status, or `null` when the overlay is off (then normal colours apply). When on, a
 * node missing from the map is `unchanged` — that is what greys the untouched boxes.
 */
export function useGitDiffStatus(nodeId: () => string): ComputedRef<DiffStatus | null> {
  const ctx = inject(gitDiffKey, null)
  return computed(() => {
    if (!ctx || !ctx.visible.value) return null
    return ctx.statusById.value[nodeId()] ?? 'unchanged'
  })
}

/**
 * The color an import edge (and everything drawn to match it — line, label, handle dots) should
 * use while the diff overlay is on, or `null` when it's off (then normal colours apply). Shared so
 * the edge renderer and the handle-dot component agree on the same green/grey without duplicating
 * the added-vs-unchanged check.
 */
export function gitDiffImportEdgeColor(
  ctx: GitDiffContext | null | undefined,
  source: string,
  target: string,
): string | null {
  if (!ctx?.visible.value) return null
  const key = importEdgeKey(source, target)
  return ctx.importDiff.value.added.has(key) ? ADDED_EDGE_COLOR : UNCHANGED_EDGE_COLOR
}
