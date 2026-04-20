/**
 * Vue composables on top of {@link overlayStore}.
 *
 * Components shouldn't talk to TinyBase directly — they read via these helpers, which
 *   1. surface a plain reactive `Ref` so `<template>` interpolation just works,
 *   2. subscribe to the underlying TinyBase listener and dispose it on unmount,
 *   3. let multiple components observe the same row with shared listeners (cheap fan-out).
 *
 * The composables follow Vue's `useX` convention; pass plain strings (not `Ref`s) for the
 * workspace and node id since the keys are stable per node — re-render the host component if
 * either ever needs to change. (None of the current call sites need a switching key.)
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue'
import {
  getInnerArtefactOverlays,
  getNodeOverlay,
  getScalaCoverage,
  getScalaDoc,
  getScalaSpecs,
  getScalaTestBlock,
  onInnerArtefactOverlayChanged,
  onNodeOverlayChanged,
  onScalaCoverageChanged,
  onScalaDocChanged,
  onScalaSpecsChanged,
  onScalaTestBlockChanged,
  type NodeOverlayRow,
  type ScalaCoverageRow,
  type ScalaSpecsRow,
  type ScalaTestBlockRow,
} from './overlayStore'

/**
 * Reactive view onto the `(workspace, nodeId)` overlay row. Returns the row as a plain
 * object — `{}` when nothing has been written yet — and refreshes itself whenever any
 * `nodeOverlays` cell changes. The listener is cheap (one TinyBase table-listener for the
 * whole component), so multiple `useNodeOverlay` calls in the same component are fine.
 */
export function useNodeOverlay(workspace: string, nodeId: string): Ref<NodeOverlayRow> {
  const value = ref<NodeOverlayRow>(getNodeOverlay(workspace, nodeId))
  const off = onNodeOverlayChanged(() => {
    value.value = getNodeOverlay(workspace, nodeId)
  })
  onScopeDispose(off)
  return value
}

/**
 * Reactive view onto the per-inner-artefact overlay maps for one parent node. Returns
 * `{ pinned: { [innerId]: true }, colors: { [innerId]: 'sky' } }`; either map may be empty.
 */
export function useInnerArtefactOverlays(
  workspace: string,
  nodeId: string,
): Ref<{ pinned: Record<string, boolean>; colors: Record<string, string> }> {
  const value = ref(getInnerArtefactOverlays(workspace, nodeId))
  const off = onInnerArtefactOverlayChanged(() => {
    value.value = getInnerArtefactOverlays(workspace, nodeId)
  })
  onScopeDispose(off)
  return value
}

/**
 * Reactive view onto the Scaladoc text for a `(workspace, nodeId)` artefact.
 *
 * Returns `''` when no documentation has been captured for this artefact (the scanner
 * writes a row only when the source had a Scaladoc block preceding the definition). The
 * ref tracks the `scalaDocs` table listener so subsequent scans / workspace clears
 * automatically flow through to any component reading the ref.
 */
export function useScalaDoc(workspace: string, nodeId: string): Ref<string> {
  const value = ref(getScalaDoc(workspace, nodeId))
  const off = onScalaDocChanged(() => {
    value.value = getScalaDoc(workspace, nodeId)
  })
  onScopeDispose(off)
  return value
}

/**
 * Reactive view onto the captured `sbt test` output block for a `(workspace, nodeId)` artefact.
 *
 * Returns `{}` when no captured block exists (no log for this example, or no suite matched).
 */
export function useScalaTestBlock(workspace: string, nodeId: string): Ref<ScalaTestBlockRow> {
  const value = ref<ScalaTestBlockRow>(getScalaTestBlock(workspace, nodeId))
  const off = onScalaTestBlockChanged(() => {
    value.value = getScalaTestBlock(workspace, nodeId)
  })
  onScopeDispose(off)
  return value
}

/**
 * Reactive view onto scoverage statement coverage for a `(workspace, nodeId)` artefact.
 * Returns `{}` when no coverage has been loaded for this workspace.
 */
export function useScalaCoverage(workspace: string, nodeId: string): Ref<ScalaCoverageRow> {
  const value = ref<ScalaCoverageRow>(getScalaCoverage(workspace, nodeId))
  const off = onScalaCoverageChanged(() => {
    value.value = getScalaCoverage(workspace, nodeId)
  })
  onScopeDispose(off)
  return value
}

/**
 * Reactive view onto scoverage statement coverage for a `(workspace, nodeId)` artefact,
 * where the workspace key itself is reactive (changes when the user switches tabs).
 *
 * Most overlay composables intentionally take plain strings (stable keys), but some
 * components mount before the workspace key is known (initial render). This variant
 * keeps the ref correct as the injected workspace key becomes available.
 */
export function useScalaCoverageKeyed(workspaceRef: Ref<string>, nodeId: string): Ref<ScalaCoverageRow> {
  const value = ref<ScalaCoverageRow>(getScalaCoverage(workspaceRef.value ?? '', nodeId))
  const refresh = () => {
    value.value = getScalaCoverage(workspaceRef.value ?? '', nodeId)
  }
  const off = onScalaCoverageChanged(refresh)
  watch(workspaceRef, refresh)
  onScopeDispose(() => {
    off()
  })
  return value
}

/**
 * Reactive view onto the "specs that mention/exercise this artefact" list for a `(workspace, nodeId)`.
 * Returns `{}` when no mapping has been loaded for this workspace.
 */
export function useScalaSpecs(workspace: string, nodeId: string): Ref<ScalaSpecsRow> {
  const value = ref<ScalaSpecsRow>(getScalaSpecs(workspace, nodeId))
  const off = onScalaSpecsChanged(() => {
    value.value = getScalaSpecs(workspace, nodeId)
  })
  onScopeDispose(off)
  return value
}
