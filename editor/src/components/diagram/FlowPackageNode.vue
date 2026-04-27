<script setup lang="ts">
/**
 * Vue Flow node for the Scala-package diagram. Sibling of {@link FlowProjectNode} so each diagram
 * can grow features independently (richer package metadata: members, imports drilldown, coverage,
 * sonarqube etc.). Hosts {@link PackageBox} for packages and, for flow `type: 'artefact'`, the same
 * node shell with {@link PackageBox} (`leaf-visual="artefact"`) when unfocused and {@link ScalaArtefactBox}
 * when layer-drill focused.
 */
import { useVueFlow } from '@vue-flow/core'
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import type { ModuleAnchorTops } from '../../graph/layoutDependencyLayers'
import {
  setInnerArtefactColorsMap,
  setInnerArtefactPinnedMap,
} from '../../store/overlayStore'
import { TRITON_WORKSPACE_FLOW_ID } from '../../graph/tritonVueFlowId'
import { openInEditor } from '../../openInEditor'
import type { Ref } from 'vue'
import DiagramFlowNode from './DiagramFlowNode.vue'
import PackageBox, {
  type InnerArtefactRelationSummary,
  type InnerArtefactSummary,
  type InnerPackageSummary,
} from './PackageBox.vue'
import ScalaArtefactBox from './ScalaArtefactBox.vue'
import { useDiagramNodeActions } from './useDiagramNodeActions'
import { useDiagramNodePinTool } from './useDiagramNodePinTool'

type LayerFlipPayload = {
  tx: number
  ty: number
  sx: number
  sy: number
  transition?: string
}

const props = defineProps<{
  id: string
  data: {
    label: string
    subtitle?: string
    /**
     * Full one-line declaration shown in the focused header subtitle (Scala artefact leaves,
     * e.g. `"object Demo extends App"`). Falls back to `subtitle` (kind keyword) when unset.
     */
    declaration?: string
    /**
     * Primary constructor parameter source text for a Scala artefact leaf (e.g.
     * `"(a: A, b: B)"` — multiple clauses concatenated, whitespace collapsed). Rendered as a
     * Shiki code block in the focused "Arguments" panel. Empty / absent for traits, objects,
     * and classes without a parameter clause; the panel then shows a short placeholder.
     */
    constructorParams?: string
    /** Constructor signatures (full lines) with source rows for click-to-open. */
    constructorSignatures?: ReadonlyArray<{ signature: string; startRow: number }>
    /**
     * Scala `def` member signatures for a Scala artefact leaf. Each entry carries the
     * signature text plus the 0-indexed source row of its declaration — the box uses the row
     * to dispatch a per-method "open at line" click. Rendered as a Shiki code block in the
     * focused Methods panel; `ScalaArtefactBox` falls back to a placeholder when the array
     * is empty or missing (packages never set this).
     */
    methodSignatures?: ReadonlyArray<{ signature: string; startRow: number }>
    /**
     * Source file relative to its owning `(root, exampleDir)` for a Scala artefact leaf —
     * used by the "open in editor" tool. Populated by `ilographToFlow` from the ilograph
     * document's `x-triton-source-file`; absent for packages and for resources without
     * a resolvable source location.
     */
    sourceFile?: string
    /** 0-indexed start row of the declaration — see {@link TritonInnerArtefactSpec.sourceRow}. */
    sourceRow?: number
    /**
     * Source-derived description (file lists, fqn, …) emitted by the scanner. Round-trips
     * through YAML unchanged so structural diffs only reflect code changes; user-typed
     * notes go to {@link notes} (overlay-backed) and are NOT written back to YAML.
     */
    description?: string
    /**
     * Free-form user note (overlay-backed). When non-empty it replaces `description` in
     * the box body. Persisted in the runtime overlay store (TinyBase + localStorage)
     * keyed by `(workspaceKey, nodeId)` — see `applyOverlayToFlowNodes` in `App.vue`.
     */
    notes?: string
    layerDrillFocus?: boolean
    drillNote?: string
    layerFlip?: LayerFlipPayload
    pinned?: boolean
    boxColor?: string
    /** Set by layout: handle `top` % aligned to partner module centers. */
    anchorTops?: ModuleAnchorTops
    /** Child packages rendered inside the box when layer-drill focused (Scala package view). */
    innerPackages?: readonly InnerPackageSummary[]
    /** Scala members listed inside the focused box (no separate flow nodes). */
    innerArtefacts?: readonly InnerArtefactSummary[]
    innerArtefactRelations?: readonly InnerArtefactRelationSummary[]
    /** Cross-package artefact edges: one endpoint in this package, the other in a different package. */
    crossArtefactRelations?: readonly InnerArtefactRelationSummary[]
    /** Nested inner drill: ids from first-tier `innerPackages` downward (flow-only UI state). */
    innerDrillPath?: readonly string[]
    /** Which inner Scala artefact row is focused (flow-only; does not change layer drill). */
    innerArtefactFocusId?: string
    /**
     * id → pinned map for inner Scala artefacts. Lifted out of {@link PackageBox} local
     * state into flow data so {@link GraphDrillIn} can detect a pinned inner artefact and
     * refuse to switch the layer drill away from this package — otherwise the click on
     * another package would unmount the focus and silently lose the pin. Round-trip pattern
     * mirrors `innerArtefactFocusId`.
     */
    innerArtefactPinned?: Record<string, boolean>
    /** id → accent color map for inner Scala artefacts (lifted from local state, same reasons). */
    innerArtefactColors?: Record<string, string>
    /** Internal flag: true when layerDrillFocus is set due to cross-package relations (not user drill). */
    __crossPackageFocus?: boolean
  }
}>()

const innerPackagesForBox = computed(() => {
  const raw = props.data.innerPackages
  return Array.isArray(raw) ? raw : []
})

const innerArtefactsForBox = computed(() => {
  const raw = props.data.innerArtefacts
  return Array.isArray(raw) ? raw : []
})

const innerArtefactRelationsForBox = computed(() => {
  const raw = props.data.innerArtefactRelations
  return Array.isArray(raw) ? raw : []
})

const crossArtefactRelationsForBox = computed(() => {
  const raw = props.data.crossArtefactRelations
  return Array.isArray(raw) ? raw : []
})

const innerDrillPathForBox = computed(() => {
  const raw = props.data.innerDrillPath
  return Array.isArray(raw) ? raw.map(String) : []
})

const { getNodes, updateNodeDimensions } = useVueFlow(TRITON_WORKSPACE_FLOW_ID)
const rootEl = ref<HTMLDivElement | null>(null)
let nodeDimensionSettleTimer: ReturnType<typeof setTimeout> | null = null

function bindRootEl(el: HTMLDivElement | null) {
  rootEl.value = el
}

/**
 * The inner artefact ID that is currently focused in ANY package node. When non-null and
 * not owned by this node, PackageBox uses it together with `crossArtefactRelations` to
 * filter its own inner artefacts to only those connected to the focused foreign artefact.
 */
const globalFocusedArtefactId = computed((): string | null => {
  for (const n of getNodes.value) {
    const fid = (n.data as Record<string, unknown>).innerArtefactFocusId
    if (typeof fid === 'string' && fid) return fid
  }
  return null
})

/**
 * `(root, dir)` of the tab's backing example on disk — provided by `App.vue` as a
 * reactive computed. Needed by {@link triggerOpenInEditor} to translate `data.sourceFile`
 * (which is relative to `<root>/<dir>`) into an absolute path for the editor URL scheme.
 * Missing / null means this diagram isn't backed by a `(root, dir)` pair (file uploads,
 * the builtin example, …) — we disable the open-in-editor button in that case.
 */
const activeExampleRef = inject<Ref<{ root: string; dir: string } | null> | undefined>(
  'tritonActiveExample',
  undefined,
)
const emitLinkAction = inject<((nodeId: string, href: string) => void) | undefined>(
  'tritonEmitLinkAction',
  undefined,
)

function onLinkAction(href: string) {
  emitLinkAction?.(props.id, href)
}

function canOpenInEditor(): boolean {
  if (!activeExampleRef?.value) return false
  if (!props.data.sourceFile) return false
  return true
}

/**
 * Dispatch an "open in editor" handoff.
 *
 * Accepts an optional 0-indexed source row: callers that want to land on a specific
 * declaration (e.g. the Methods panel clicking an individual `def`) pass the method's
 * row; callers that just want to jump to the artefact itself (the tool button, the
 * Arguments panel, clicking the header declaration) omit the argument and we fall back
 * to the leaf's own `data.sourceRow`. All rows are 0-indexed at this layer and bumped
 * to 1 when composing the editor URL.
 */
function triggerOpenInEditor(line?: number): void {
  const ex = activeExampleRef?.value
  const relPath = props.data.sourceFile
  if (!ex || !relPath) return
  const effectiveRow = line !== undefined ? line : (props.data.sourceRow ?? 0)
  openInEditor({
    root: ex.root,
    exampleDir: ex.dir,
    relPath,
    // Tree-sitter `startRow` is 0-indexed; editor URL schemes are 1-indexed.
    line: effectiveRow + 1,
  })
}

/** Same Vue node shell as packages so layout + chrome stay aligned (`type` from flow graph). */
const isScalaArtefactLeaf = computed(() => getNodes.value.find((n) => n.id === props.id)?.type === 'artefact')

const queueViewportStabilize = inject<(() => void) | undefined>('tritonQueueViewportStabilize', undefined)
const showPinTool = useDiagramNodePinTool({
  nodeId: props.id,
  nodes: getNodes,
  pinned: () => props.data.pinned,
  layerDrillFocus: () => props.data.layerDrillFocus,
})

const {
  updateNodeData,
  patchNodeData,
  ws,
  cycleColor,
  onRename,
  onDescriptionChange,
  togglePin,
} = useDiagramNodeActions({
  nodeId: props.id,
  label: () => props.data.label,
  notes: () => props.data.notes,
  pinned: () => props.data.pinned,
  boxColor: () => props.data.boxColor,
})

function onUpdateInnerDrillPath(path: string[]) {
  const patch: Record<string, unknown> = { innerDrillPath: path }
  if (path.length > 0) patch.innerArtefactFocusId = undefined
  patchNodeData?.(props.id, patch)
  updateNodeData(props.id, patch)
}

function onInnerArtefactFocus(id: string | null) {
  if (id === null || id === '') {
    patchNodeData?.(props.id, { innerArtefactFocusId: undefined })
    updateNodeData(props.id, { innerArtefactFocusId: undefined })
    return
  }
  const cur = props.data.innerArtefactFocusId as string | undefined
  const next = cur === id ? undefined : id
  patchNodeData?.(props.id, { innerArtefactFocusId: next })
  updateNodeData(props.id, { innerArtefactFocusId: next })
}

/** Replace the per-inner-artefact pin map (PackageBox owns the toggle logic; we just persist). */
function onInnerArtefactPinned(map: Record<string, boolean>) {
  patchNodeData?.(props.id, { innerArtefactPinned: map })
  updateNodeData(props.id, { innerArtefactPinned: map })
  setInnerArtefactPinnedMap(ws(), props.id, map)
}

/** Replace the per-inner-artefact accent-color map (same persistence model as pin). */
function onInnerArtefactColors(map: Record<string, string>) {
  patchNodeData?.(props.id, { innerArtefactColors: map })
  updateNodeData(props.id, { innerArtefactColors: map })
  setInnerArtefactColorsMap(ws(), props.id, map)
}

/** Trigger a Vue Flow layout recalculation (e.g., when cross-package preview expands). */
function onLayoutUpdateRequest() {
  refreshOwnNodeDimensions()
  // Trigger a window resize event to simulate the user's window resize action
  // This triggers the ResizeObservers which then trigger the proper layout recalculation
  window.dispatchEvent(new Event('resize'))
  queueViewportStabilize?.()
}

function refreshOwnNodeDimensions() {
  const el = rootEl.value?.parentElement as HTMLDivElement | null
  if (el) updateNodeDimensions([{ id: props.id, nodeElement: el, forceUpdate: true }])
}

async function refreshOwnNodeDimensionsSettled() {
  await nextTick()
  refreshOwnNodeDimensions()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  refreshOwnNodeDimensions()
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
  refreshOwnNodeDimensions()
  queueViewportStabilize?.()
  if (nodeDimensionSettleTimer != null) clearTimeout(nodeDimensionSettleTimer)
  nodeDimensionSettleTimer = setTimeout(() => {
    nodeDimensionSettleTimer = null
    refreshOwnNodeDimensions()
    queueViewportStabilize?.()
  }, 520)
}

watch(
  () => props.data.layerDrillFocus,
  (next, prev) => {
    if (!(prev === true && next !== true)) return
    patchNodeData?.(props.id, { innerDrillPath: [], innerArtefactFocusId: undefined })
    updateNodeData(props.id, { innerDrillPath: [], innerArtefactFocusId: undefined })
  },
)

watch(
  globalFocusedArtefactId,
  async () => {
    queueViewportStabilize?.()
    if (!crossArtefactRelationsForBox.value.length) return
    await refreshOwnNodeDimensionsSettled()
  },
)

watch(
  () => props.data.innerArtefactFocusId,
  async () => {
    queueViewportStabilize?.()
    if (!crossArtefactRelationsForBox.value.length) return
    await refreshOwnNodeDimensionsSettled()
  },
)

onUnmounted(() => {
  if (nodeDimensionSettleTimer != null) {
    clearTimeout(nodeDimensionSettleTimer)
    nodeDimensionSettleTimer = null
  }
})
</script>

<template>
  <DiagramFlowNode
    :id="id"
    variant-class="flow-graph-node--package"
    :layer-flip="data.layerFlip"
    :anchor-tops="data.anchorTops"
    :root-el-ref="bindRootEl"
  >
    <ScalaArtefactBox
      v-if="isScalaArtefactLeaf && data.layerDrillFocus"
      :box-id="id"
      :label="data.label"
      :subtitle="data.subtitle"
      :declaration="data.declaration"
      :description="data.description"
      :constructor-params="data.constructorParams"
      :constructor-signatures="data.constructorSignatures"
      :method-signatures="data.methodSignatures"
      :notes="data.drillNote"
      :box-color="data.boxColor"
      :pinned="!!data.pinned"
      :show-pin-tool="showPinTool"
      :show-color-tool="true"
      :can-open-in-editor="canOpenInEditor()"
      @toggle-pin="togglePin"
      @cycle-color="cycleColor"
      @open-in-editor="(line?: number) => triggerOpenInEditor(line)"
    />
    <PackageBox
      v-else-if="isScalaArtefactLeaf"
      leaf-visual="artefact"
      :box-id="id"
      :label="data.label"
      :subtitle="data.subtitle ?? ''"
      :declaration="data.declaration"
      description=""
      :notes="data.drillNote"
      :box-color="data.boxColor"
      :pinned="!!data.pinned"
      :focused="false"
      :show-pin-tool="showPinTool"
      :show-color-tool="false"
      @toggle-pin="togglePin"
      @cycle-color="cycleColor"
      @link-action="onLinkAction"
    />
    <PackageBox
      v-else
      :box-id="id"
      :label="data.label"
      :subtitle="data.subtitle"
      :description="(data.notes as string | undefined) || data.description"
      :notes="data.drillNote"
      :box-color="data.boxColor"
      :pinned="!!data.pinned"
      :focused="!!data.layerDrillFocus"
      :show-pin-tool="showPinTool"
      :show-color-tool="!!data.layerDrillFocus"
      :cross-package-focused="!!data.__crossPackageFocus"
      :inner-packages="innerPackagesForBox"
      :inner-artefacts="innerArtefactsForBox"
      :inner-artefact-relations="innerArtefactRelationsForBox"
      :cross-artefact-relations="crossArtefactRelationsForBox"
      :global-focused-artefact-id="globalFocusedArtefactId"
      :inner-drill-path="innerDrillPathForBox"
      :focused-inner-artefact-id="data.innerArtefactFocusId"
      :inner-artefact-pinned="data.innerArtefactPinned"
      :inner-artefact-colors="data.innerArtefactColors"
      @toggle-pin="togglePin"
      @cycle-color="cycleColor"
      @rename="onRename"
      @description-change="onDescriptionChange"
      @update-inner-drill-path="onUpdateInnerDrillPath"
      @update-inner-artefact-focus="onInnerArtefactFocus"
      @update-inner-artefact-pinned="onInnerArtefactPinned"
      @update-inner-artefact-colors="onInnerArtefactColors"
      @layout-update-request="onLayoutUpdateRequest"
      @link-action="onLinkAction"
    />
  </DiagramFlowNode>
</template>
