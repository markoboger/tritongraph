<script setup lang="ts">
/**
 * Vue Flow node for the Scala-package diagram. Sibling of {@link FlowProjectNode} so each diagram
 * can grow features independently (richer package metadata: members, imports drilldown, coverage,
 * sonarqube etc.). Hosts {@link PackageBox} for packages and, for flow `type: 'artefact'`, the same
 * node shell with {@link PackageBox} (`leaf-visual="artefact"`) when unfocused and {@link ScalaArtefactBox}
 * when layer-drill focused. Does not relay subtitle link-action clicks (package boxes have no markdown
 * links yet — re-add the `tritonEmitLinkAction` injection here when that changes).
 */
import { useVueFlow } from '@vue-flow/core'
import { computed, inject, nextTick, ref, watch } from 'vue'
import { boxColorForId, nextNamedBoxColor } from '../../graph/boxColors'
import type { ModuleAnchorTops } from '../../graph/layoutDependencyLayers'
import {
  setInnerArtefactColorsMap,
  setInnerArtefactPinnedMap,
  setNodeColor,
  setNodeNotes,
  setNodePinned,
} from '../../store/overlayStore'
import { openInEditor } from '../../openInEditor'
import type { Ref } from 'vue'
import DepthRelationHandles from '../common/DepthRelationHandles.vue'
import DiagramSection from './DiagramSection.vue'
import PackageBox, {
  type InnerArtefactRelationSummary,
  type InnerArtefactSummary,
  type InnerPackageSummary,
} from './PackageBox.vue'
import ScalaArtefactBox from './ScalaArtefactBox.vue'

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

const { updateNodeData, getNodes, updateNodeDimensions } = useVueFlow()
const rootEl = ref<HTMLDivElement | null>(null)
let nodeDimensionSettleTimer: ReturnType<typeof setTimeout> | null = null

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

/** Active workspace key (see `App.vue`) — empty string = no overlay-store writes. */
const workspaceKey = inject<{ value: string } | undefined>('tritonWorkspaceKey', undefined)
function ws(): string {
  return workspaceKey?.value ?? ''
}

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

const refreshDimming = inject<(() => void) | undefined>('tritonRefreshDimming', undefined)
const relayoutViewport = inject<(() => void | Promise<void>) | undefined>('tritonRelayoutViewport', undefined)
const graphFocusUi = inject<{ containerFocusId: string | null } | undefined>('tritonGraphFocusUi', undefined)
const patchNodeData = inject<((id: string, patch: Record<string, unknown>) => void) | undefined>(
  'tritonPatchNodeData',
  undefined,
)

function moduleInContainerFocusTree(focusId: string, moduleId: string): boolean {
  const nodes = getNodes.value
  if (focusId === moduleId) return true
  const desc = new Set<string>([focusId])
  let frontier = [focusId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const n of nodes) {
        if (String(n.parentNode) === id && !desc.has(n.id)) {
          desc.add(n.id)
          next.push(n.id)
        }
      }
    }
    frontier = next
  }
  if (desc.has(moduleId)) return true
  let cur = nodes.find((n) => n.id === moduleId)
  while (cur?.parentNode) {
    const pid = String(cur.parentNode)
    if (pid === focusId) return true
    cur = nodes.find((n) => n.id === pid)
  }
  return false
}

const showPinTool = computed(() => {
  if (props.data.pinned) return true
  if (props.data.layerDrillFocus) return true
  const fid = graphFocusUi?.containerFocusId
  if (!fid) return false
  return moduleInContainerFocusTree(fid, props.id)
})

const layerFlipStyle = computed((): Record<string, string> => {
  const f = props.data.layerFlip
  if (!f) return {}
  return {
    transform: `translate(${f.tx}px, ${f.ty}px)`,
    transformOrigin: '0 0',
    transition: f.transition ?? 'none',
  }
})

const layerFlipCounterStyle = computed((): Record<string, string> => {
  return {}
})

function cycleColor() {
  const accent = (props.data.boxColor as string) || boxColorForId(props.id)
  const next = nextNamedBoxColor(accent)
  updateNodeData(props.id, { boxColor: next })
  patchNodeData?.(props.id, { boxColor: next })
  setNodeColor(ws(), props.id, next)
}

function onRename(newLabel: string) {
  if (!newLabel || newLabel === props.data.label) return
  patchNodeData?.(props.id, { label: newLabel })
  updateNodeData(props.id, { label: newLabel })
}

/**
 * The "description editor" is repurposed as a user-note editor here too — value goes
 * to the overlay store and `data.notes`, never to YAML. See `FlowProjectNode.vue` and
 * `applyOverlayToFlowNodes` in `App.vue` for the merge-on-load side.
 */
function onDescriptionChange(newDescription: string) {
  const cur = (props.data.notes as string | undefined) ?? ''
  if (newDescription === cur) return
  patchNodeData?.(props.id, { notes: newDescription })
  updateNodeData(props.id, { notes: newDescription })
  setNodeNotes(ws(), props.id, newDescription)
}

function togglePin(ev: MouseEvent) {
  ev.stopPropagation()
  const next = !props.data.pinned
  updateNodeData(props.id, { pinned: next })
  patchNodeData?.(props.id, { pinned: next })
  setNodePinned(ws(), props.id, next)
  void nextTick(async () => {
    refreshDimming?.()
    await relayoutViewport?.()
  })
}

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
  if (nodeDimensionSettleTimer != null) clearTimeout(nodeDimensionSettleTimer)
  nodeDimensionSettleTimer = setTimeout(() => {
    nodeDimensionSettleTimer = null
    refreshOwnNodeDimensions()
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
    if (!crossArtefactRelationsForBox.value.length) return
    await refreshOwnNodeDimensionsSettled()
  },
)

watch(
  () => props.data.innerArtefactFocusId,
  async () => {
    if (!crossArtefactRelationsForBox.value.length) return
    await refreshOwnNodeDimensionsSettled()
  },
)
</script>

<template>
  <div ref="rootEl" class="flow-graph-node flow-graph-node--package">
    <div class="flow-graph-node__flip-outer" :style="layerFlipStyle">
      <div class="flow-graph-node__flip-counter" :style="layerFlipCounterStyle">
        <DiagramSection>
          <ScalaArtefactBox
            v-if="isScalaArtefactLeaf && data.layerDrillFocus"
            :box-id="id"
            :label="data.label"
            :subtitle="data.subtitle"
            :declaration="data.declaration"
            :constructor-params="data.constructorParams"
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
            description=""
            :notes="data.drillNote"
            :box-color="data.boxColor"
            :pinned="!!data.pinned"
            :focused="false"
            :show-pin-tool="showPinTool"
            :show-color-tool="false"
            @toggle-pin="togglePin"
            @cycle-color="cycleColor"
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
            :skip-inner-artifact-rendering="false"
            @toggle-pin="togglePin"
            @cycle-color="cycleColor"
            @rename="onRename"
            @description-change="onDescriptionChange"
            @update-inner-drill-path="onUpdateInnerDrillPath"
            @update-inner-artefact-focus="onInnerArtefactFocus"
            @update-inner-artefact-pinned="onInnerArtefactPinned"
            @update-inner-artefact-colors="onInnerArtefactColors"
            @layout-update-request="onLayoutUpdateRequest"
          />
        </DiagramSection>
      </div>
    </div>
    <DepthRelationHandles
      :node-id="id"
      :anchor-tops="data.anchorTops"
      target-class="handle-agg-in-target"
      source-class="handle-agg-fan-out"
    />
  </div>
</template>

<style scoped>
.flow-graph-node {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.flow-graph-node__flip-outer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  transform-origin: 0 0;
  z-index: 0;
}
.flow-graph-node__flip-counter {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  width: 100%;
  height: 100%;
}
.handle {
  position: absolute;
  z-index: 12;
}
</style>
