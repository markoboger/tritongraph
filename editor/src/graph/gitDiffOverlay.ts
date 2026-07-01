import { computed, inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { CodeContainer, CodeModel } from '../../../packages/triton-core/src/languageModel'

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

/** Provided by App.vue, injected by the box components. Toggling `visible` greys/colours every box. */
export interface GitDiffContext {
  visible: Ref<boolean>
  statusById: Ref<Record<string, DiffStatus>>
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
