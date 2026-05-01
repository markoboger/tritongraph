<script setup lang="ts">
defineOptions({ name: 'PackageBox' })

/**
 * Package node body for the Scala-package diagram.
 *
 * Sibling of {@link ProjectBox} (sbt build view): both fit into the same Vue Flow node shell and
 * use the same accent / pin / focus / editing affordances, but they are intentionally separate
 * components so each can grow features that only make sense in its own diagram (package box will
 * surface things like file/member lists, test coverage, sonar metrics, link-out to specs etc.;
 * the project box stays focused on sbt module ergonomics).
 *
 * Initial divergences from {@link ProjectBox}:
 *   - Folder icon (hardcoded — packages are always folder-shaped).
 *   - Plain-text subtitle (no markdown link parsing; package boxes don't have outbound diagram links yet).
 */
import { computed, inject, nextTick, ref, watch, type Ref } from 'vue'
import type {
  TritonInnerArtefactRelationSpec,
  TritonInnerArtefactSpec,
  TritonInnerPackageSpec,
} from '../../ilograph/types'
import { boxColorForId, type NamedBoxColor } from '../../graph/boxColors'
import folderIconUrl from '../../assets/language-icons/folder.svg'
import scalaIconUrl from '../../assets/language-icons/scala.svg'
import scalaClassIconUrl from '../../assets/language-icons/scala-class.svg'
import scalaTraitIconUrl from '../../assets/language-icons/scala-trait.svg'
import scalaObjectIconUrl from '../../assets/language-icons/scala-object.svg'
import scalaEnumIconUrl from '../../assets/language-icons/scala-enum.svg'
import ShikiInlineCode from '../ShikiInlineCode.vue'
import BoxEditDialog from '../common/BoxEditDialog.vue'
import GeneralFocusedBox from '../common/GeneralFocusedBox.vue'
import MarkdownActionSubtitle from '../common/MarkdownActionSubtitle.vue'
import BoxMetricStrip from '../common/BoxMetricStrip.vue'
import BoxToolbar from '../common/BoxToolbar.vue'
import { buildFocusedBoxCompartments } from '../common/focusedBoxCompartments'
import { useEditableBox } from '../common/useEditableBox'
import { useBoxMetrics } from '../common/useBoxMetrics'
import BoxCompartments from '../common/BoxCompartments.vue'
import type { BoxCompartment } from '../../diagram/boxCompartments'
import { shouldHideEdgeForRelationFilter } from '../../graph/relationVisibility'
import { useInnerDiagramScroll } from './useInnerDiagramScroll'
import PackageInnerDiagram from './PackageInnerDiagram.vue'
import { useInnerArtefactRouting } from './useInnerArtefactRouting'
import { useInnerArtefactEdges } from './useInnerArtefactEdges'
import { usePackageBoxChromeLayout } from './usePackageBoxChromeLayout'
import { useInnerArtefactState } from './useInnerArtefactState'
import { useInnerPackageDrill } from './useInnerPackageDrill'
import { useInnerArtefactLayering } from './useInnerArtefactLayering'
import { artefactPackageId } from './innerArtefactGraphHelpers'
import { assignInnerArtefactLayers } from '../../graph/innerArtefactLayerLayout'
import ScalaArtefactBox from './ScalaArtefactBox.vue'
import InnerDiagramScrollRails from './InnerDiagramScrollRails.vue'
import KindBadge from './KindBadge.vue'

/**
 * Pick the kind-specific Scala badge (class / trait / object / enum) for a Scala leaf
 * artefact based on its `subtitle`, which carries the Scala kind keyword as parsed by
 * tree-sitter (`'class' | 'case class' | 'object' | 'case object' | 'trait' | 'enum'`).
 * Anything outside that set (e.g. `def`, `val`, `type`, `given`) falls back to the
 * generic Scala lambda mark — matches the existing `kindBadge` letter scheme in
 * {@link ScalaArtefactBox}, but as image assets so the unfocused chrome stays purely
 * declarative without a per-kind text badge.
 */
function scalaIconForKind(subtitle: string | undefined): string {
  const k = (subtitle ?? '').trim().toLowerCase()
  if (k === 'class' || k === 'case class') return scalaClassIconUrl
  if (k === 'object' || k === 'case object') return scalaObjectIconUrl
  if (k === 'trait') return scalaTraitIconUrl
  if (k === 'enum') return scalaEnumIconUrl
  return scalaIconUrl
}

function kindBadgeForLeafArtefact(subtitle: string | undefined): string | null {
  const k = (subtitle ?? '').trim().toLowerCase()
  // For TS examples we use these as the "kind" values; show the same badge when unfocused.
  if (k === 'interface') return 'I'
  if (k === 'class') return 'C'
  if (k === 'type') return 'τ'
  if (k === 'function') return 'ƒ'
  if (k === 'enum') return 'E'
  return null
}

export type InnerPackageSummary = TritonInnerPackageSpec
export type InnerArtefactSummary = TritonInnerArtefactSpec
export type InnerArtefactRelationSummary = TritonInnerArtefactRelationSpec

const props = withDefaults(
  defineProps<{
    boxId: string
    label: string
    subtitle?: string
    /**
     * Full one-line declaration (`"object Demo extends App"`). When the box is focused we show
     * this in the header subtitle instead of the bare kind keyword from `subtitle` — packages
     * don't set it and gracefully fall back to their existing subtitle text.
     */
    declaration?: string
    /** Shown when the box is focused (layer drill). */
    notes?: string
    /** Free-text "what does this package contains" — surfaced in the AI prompt. */
    description?: string
    boxColor?: NamedBoxColor | string
    pinned: boolean
    focused: boolean
    showPinTool: boolean
    /** Layer-drill focused box only: show accent color picker. */
    showColorTool: boolean
    /** Child packages drawn inside the focused root (stacked); not used on embedded rows. */
    innerPackages?: readonly InnerPackageSummary[]
    /**
     * Top-level Scala members for this package, shown only when layer-drill focused and not
     * drilling into an inner package row (same dashed inner panel as `innerPackages`).
     */
    innerArtefacts?: readonly InnerArtefactSummary[]
    /** Same-package `extends` / `with` (parent → child), from YAML / graph generation. */
    innerArtefactRelations?: readonly InnerArtefactRelationSummary[]
    /** Cross-package artefact edges: one endpoint is in this package, the other is foreign. */
    crossArtefactRelations?: readonly InnerArtefactRelationSummary[]
    /**
     * The inner artefact ID currently focused in any package node (may be foreign to this box).
     * Used together with `crossArtefactRelations` to filter this box when another package's
     * artefact is focused.
     */
    globalFocusedArtefactId?: string | null
    /**
     * Path of inner package ids from the first tier under this node (`innerPackages`) downward.
     * Scoped UI state: outer `layerDrillFocus` stays unchanged while this drills inside the box.
     */
    innerDrillPath?: readonly string[]
    /** Flow-only: which inner artefact row is selected (same scope as `innerDrillPath` — does not affect layer drill). */
    focusedInnerArtefactId?: string
    /**
     * Flow-only: id → pinned map for inner artefacts. Lifted from local component state into
     * the parent flow node's `data` so the drill machinery in {@link GraphDrillIn} can detect
     * that an inner artefact is pinned and refuse to switch the layer drill away from this
     * package — otherwise clicking another package would unmount the focus and lose the pin.
     * Mirrors the round-trip pattern already used by `focusedInnerArtefactId`.
     */
    innerArtefactPinned?: Record<string, boolean>
    /** Flow-only: id → accent color map for inner artefacts (lifted from local state, same reasons). */
    innerArtefactColors?: Record<string, string>
    /** Compact card used only as a child inside another package box (no tools / no drill UI). */
    embedded?: boolean
    /**
     * `artefact`: top-level Scala declaration leaf — reuses this box’s chrome, tight layout, and
     * accent strip as packages; Scala logo instead of folder; rename/description editor disabled
     * ({@link FlowPackageNode} when flow `type` is `artefact` and the box is not layer-drill focused).
     */
    leafVisual?: 'package' | 'artefact'
    /**
     * True when this package is focused due to cross-package relations (not user-initiated layer drill).
     * Used to hide the focused chrome (pin tools, color tools) to avoid confusion.
     */
    crossPackageFocused?: boolean
    /**
     * Focused box is rendered inside another package’s inner diagram (e.g. expanded Scala artefact).
     * Forces the same horizontal compact header as {@link GeneralFocusedBox}`innerDiagramHost`.
     */
    innerDiagramDescendant?: boolean
    /** Resolved from YAML `x-triton-icon` — overrides folder / Scala leaf icon when set. */
    iconUrl?: string
  }>(),
  {
    innerPackages: () => [],
    innerArtefacts: () => [],
    innerArtefactRelations: () => [],
    crossArtefactRelations: () => [],
    globalFocusedArtefactId: null,
    innerDrillPath: () => [],
    embedded: false,
    leafVisual: 'package',
    crossPackageFocused: false,
    innerDiagramDescendant: false,
  },
)

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
  rename: [string]
  'description-change': [string]
  'update-inner-drill-path': [string[]]
  /** Toggle or clear inner artefact focus (`null` = clear only). */
  'update-inner-artefact-focus': [string | null]
  /** Toggle inner artefact pin. */
  'update-inner-artefact-pin': [string, boolean]
  /** Update inner drill path to a specific package ID (drill in one level). */
  'update-inner-drill-path-to': [string]
  /** Update inner artefact pinned state. */
  'update-inner-artefact-pinned': [Record<string, boolean>]
  /** Update inner artefact colors. */
  'update-inner-artefact-colors': [Record<string, string>]
  /**
   * Fired when the user clicks the Scala declaration line in the focused header. Parent
   * resolves it as an "open at the class declaration row" handoff — see
   * `ScalaArtefactBox` for the wiring; plain (non-Scala) callers can simply ignore this
   * event, the template only renders a clickable wrapper when `isScalaLeaf` is true.
   */
  'declaration-click': []
  /** Request a layout update from the parent (e.g., when cross-package preview expands). */
  'layout-update-request': []
  /** Markdown-link click on a package subtitle. */
  'link-action': [string]
}>()

const accent = computed(() => (props.boxColor as string) || boxColorForId(props.boxId))

const focusedLegacyCompartments = computed<readonly BoxCompartment[]>(() =>
  buildFocusedBoxCompartments({
    description: props.description,
    notes: props.notes,
  }),
)

const isScalaLeaf = computed(() => props.leafVisual === 'artefact')

const headerIconUrlForPackage = computed(() => {
  const u = props.iconUrl?.trim()
  if (u) return u
  if (isScalaLeaf.value) return scalaIconForKind(props.subtitle)
  return folderIconUrl
})


const relationTypeVisibilityRef = inject<Ref<Record<string, boolean>>>(
  'tritonRelationTypeVisibility',
  ref({}),
)
const nodeTypeVisibilityRef = inject<Ref<Record<string, boolean>>>(
  'tritonNodeTypeVisibility',
  ref({}),
)
const focusRelationDepthRef = inject<Ref<number>>('tritonFocusRelationDepth', ref(1))

/**
 * Real coverage percentage from Scoverage (when available).
 *
 * Important: do not show any placeholder. When no coverage is known for this artefact,
 * we render **no** coverage indicator at all.
 */
const { hasCoverage, coveragePercentValue, simulatedMetrics } = useBoxMetrics(() => props.boxId)


const {
  innerDrillPathArr,
  activeInnerSpec,
  topLevelInnerPackages,
  hasInnerDiagram,
  onInnerCardClick,
  clearInnerDrill,
  innerDrillBackOne,
} = useInnerPackageDrill({
  innerPackages: () => props.innerPackages,
  innerArtefacts: () => props.innerArtefacts,
  innerDrillPath: () => props.innerDrillPath,
  updateInnerDrillPath: (path) => emit('update-inner-drill-path', [...path]),
  updateInnerArtefactFocus: (id) => emit('update-inner-artefact-focus', id),
})

const drilledInnerPackageId = computed(() => activeInnerSpec.value?.id ?? null)
const focusedPackageTitle = computed(() => props.label)
const focusedPackageSubtitle = computed(() => props.declaration || props.subtitle)
const packageSubtitleLinkText = computed(() => {
  if (isScalaLeaf.value || !props.subtitle?.trim()) return ''
  const escaped = props.subtitle.replace(/([\\\]\[])/g, '\\$1')
  return `[${escaped}](triton://diagram/package?node=${encodeURIComponent(props.boxId)})`
})
const drilledInnerArtefacts = computed(() => {
  const all = props.innerArtefacts
  const drilledId = drilledInnerPackageId.value
  if (!drilledId) return all
  return all.filter((a) => {
    const pkgId = artefactPackageId(a.id)
    return pkgId === drilledId || pkgId.startsWith(`${drilledId}.`)
  })
})

const visibleInnerArtefacts = computed(() => {
  const drilledId = drilledInnerPackageId.value
  const kindVisible = (artefact: TritonInnerArtefactSpec) => {
    const key = (artefact.subtitle ?? '').trim().toLowerCase() || '(unknown)'
    return nodeTypeVisibilityRef.value[key] !== false
  }
  if (drilledId) return drilledInnerArtefacts.value.filter(kindVisible)
  // Root view: if we have folder packages, show only those (no artefact rows).
  if ((props.innerPackages?.length ?? 0) > 0) return []
  return props.innerArtefacts.filter(kindVisible)
})

const routingInnerArtefacts = computed(() => {
  // Routing needs the full set at the root so we can derive folder→folder edges from
  // artefact→artefact relations (even when artefacts are hidden from the UI).
  const drilledId = drilledInnerPackageId.value
  if (drilledId) return drilledInnerArtefacts.value
  if ((props.innerPackages?.length ?? 0) === 0) return visibleInnerArtefacts.value
  return props.innerArtefacts
})

const visibleInnerArtefactRelations = computed(() => {
  const rels = props.innerArtefactRelations
  if (!Array.isArray(rels) || !rels.length) return []
  const ids = new Set(visibleInnerArtefacts.value.map((a) => a.id))
  return rels.filter((r) => ids.has(r.from) && ids.has(r.to))
})

const {
  innerCoverageVersion,
  innerArtefactCell,
  openInnerArtefactInEditor,
  canOpenInnerArtefactInEditor,
  innerHasCoverage,
  innerCoveragePercentValue,
  innerSimulatedMetrics,
  isInnerArtefactPinned,
  innerArtefactAccent,
  onInnerArtefactTogglePin,
  onInnerArtefactCycleColor,
  onArtefactRowClick,
  onFocusedArtefactBackgroundClick,
} = useInnerArtefactState({
  innerArtefacts: () => visibleInnerArtefacts.value,
  innerArtefactPinned: () => props.innerArtefactPinned,
  innerArtefactColors: () => props.innerArtefactColors,
  updateInnerArtefactPinned: (next) => emit('update-inner-artefact-pinned', next),
  updateInnerArtefactColors: (next) => emit('update-inner-artefact-colors', next),
  updateInnerArtefactFocus: (id) => emit('update-inner-artefact-focus', id),
})

/** Keeps compact header while drilling inner packages (see `hasInnerDiagram` vs drill path). */
const nodeHasInnerDiagramPayload = computed(
  () => (props.innerPackages?.length ?? 0) > 0 || (props.innerArtefacts?.length ?? 0) > 0,
)

const {
  allInnerArtefactRelations,
  innerArtefactFocusActive,
  crossPackagePreviewActive,
  innerArtefactLayerColumns,
} = useInnerArtefactLayering({
  focused: () => props.focused,
  innerDrillPath: () => innerDrillPathArr.value,
  innerArtefacts: () => visibleInnerArtefacts.value,
  innerArtefactRelations: () => visibleInnerArtefactRelations.value,
  crossArtefactRelations: () => (drilledInnerPackageId.value ? [] : props.crossArtefactRelations),
  focusedInnerArtefactId: () => props.focusedInnerArtefactId ?? null,
  globalFocusedArtefactId: () => props.globalFocusedArtefactId ?? null,
  focusRelationDepth: () => focusRelationDepthRef.value,
})

const {
  rootEl,
  titleEl,
  packageBodyEl,
  tightLayout,
  flatLayout,
  superflatLayout,
  compactLayout,
  metricsBreakLayout,
  superslimLayout,
  slimLayout,
  subtitleHiddenForVerticalTitle,
} = usePackageBoxChromeLayout({
  embedded: () => props.embedded,
  focused: () => props.focused,
  label: () => String(props.label ?? ''),
  hasCoverage: () => hasCoverage.value,
  issueCount: () => simulatedMetrics.value.issueCount,
  watchSources: () => [
    props.label,
    props.subtitle,
    props.focused,
    props.notes,
    props.pinned,
    props.boxColor,
    props.showPinTool,
    props.showColorTool,
    props.innerPackages,
    props.innerArtefacts,
    props.innerArtefactRelations,
    props.innerDrillPath,
    props.focusedInnerArtefactId,
    props.embedded,
    props.leafVisual,
    props.iconUrl,
    props.boxId,
    hasCoverage.value,
    simulatedMetrics.value.issueCount,
    innerCoverageVersion.value,
    crossPackagePreviewActive.value,
  ],
})

/** Relations currently visible in the UI after applying the relation-type checkboxes. */
const innerArtefactRelationList = computed((): readonly TritonInnerArtefactRelationSpec[] => {
  const visibility = relationTypeVisibilityRef.value
  return allInnerArtefactRelations.value.filter(
    (rel) => !shouldHideEdgeForRelationFilter({ label: rel.label }, visibility),
  )
})

/** Cross-package relations currently visible in the UI after applying the relation-type checkboxes. */
const visibleCrossArtefactRelations = computed((): readonly TritonInnerArtefactRelationSpec[] => {
  const visibility = relationTypeVisibilityRef.value
  const base = (props.crossArtefactRelations ?? []).filter(
    (rel) => !shouldHideEdgeForRelationFilter({ label: rel.label }, visibility),
  )

  // TypeScript folder→folder “imports” are authored as inner-artefact relations (artefact→artefact)
  // and then collapsed to package→package bridges in `useInnerArtefactRouting`.
  const imports = (props.innerArtefactRelations ?? [])
    .filter((rel) => rel.label === 'imports')
    .filter((rel) => !shouldHideEdgeForRelationFilter({ label: rel.label }, visibility))

  return [...base, ...imports]
})

const innerEdgeMarkerId = computed(() =>
  `tg-inner-inh-${String(props.boxId).replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
)

const innerArtefactDiagramRef = ref<HTMLElement | null>(null)
// ── inner diagram scroll state ────────────────────────────────────────────
const innerDiagramColsRef = ref<HTMLElement | null>(null)
const {
  innerScrollX,
  innerScrollY,
  innerHScrollNeeded,
  innerVScrollNeeded,
  innerHScrollRatio,
  innerVScrollRatio,
  innerVThumbStyle,
  innerHThumbStyle,
  updateInnerScrollMetrics,
  onInnerWheel,
  onInnerPointerDown,
  onInnerHSliderInput,
  onInnerVSliderInput,
  resetInnerScroll,
} = useInnerDiagramScroll({
  containerRef: innerArtefactDiagramRef,
  colsRef: innerDiagramColsRef,
})
function bindInnerArtefactDiagramEl(el: unknown) {
  innerArtefactDiagramRef.value = el instanceof HTMLElement ? el : null
}

function bindInnerDiagramColsEl(el: unknown) {
  innerDiagramColsRef.value = el instanceof HTMLElement ? el : null
}

const {
  crossPackageBridgeRelations,
  crossPackageBoundaryStubRelations,
  crossPackageExternalEndpoints,
  childPackagePortsById,
  rootPackagePortsLeft,
  rootPackagePortsRight,
  routedCrossPackageBridgeRelations,
} = useInnerArtefactRouting({
  boxId: () => props.boxId,
  focused: () => props.focused,
  innerDrillPath: () => innerDrillPathArr.value,
  innerPackages: () => props.innerPackages,
  innerArtefacts: () => routingInnerArtefacts.value,
  visibleCrossArtefactRelations: () => visibleCrossArtefactRelations.value,
  crossPackagePreviewActive: () => crossPackagePreviewActive.value,
  focusedInnerArtefactId: () => props.focusedInnerArtefactId ?? null,
})

const topLevelInnerPackageColumns = computed((): TritonInnerPackageSpec[][] => {
  const pkgs = topLevelInnerPackages.value
  if (!pkgs.length) return []
  const edges = crossPackageBridgeRelations.value
    .filter((e) => e.label === 'imports')
    .filter((e) => pkgs.some((p) => p.id === e.from) && pkgs.some((p) => p.id === e.to))
    .map((e) => ({ from: e.from, to: e.to }))
  if (!edges.length) return [pkgs as TritonInnerPackageSpec[]]
  const layers = assignInnerArtefactLayers(
    pkgs.map((p) => p.id),
    edges,
  )
  const byId = new Map(pkgs.map((p) => [p.id, p] as const))
  return layers.map((col) => col.map((id) => byId.get(id)).filter(Boolean) as TritonInnerPackageSpec[])
})

const {
  routedOverlayInnerEdgeDraws,
  emphasizedInnerEdgeDraws,
  normalInnerEdgeDraws,
  innerEdgeLabelSvgStyleFor,
  innerEdgeEmphasized,
  innerArtefactEmphasized,
  onInnerEdgeEnter,
  onInnerEdgeLeave,
  onInnerArtefactSlotEnter,
  onInnerArtefactSlotLeave,
  bindInnerArtefactSlotEl,
  scheduleInnerEdgeRefresh,
  scheduleInnerEdgeRefreshSettled,
  observeInnerArtefactDiagram,
  observeInnerArtefactHost,
} = useInnerArtefactEdges({
  boxId: () => props.boxId,
  diagramRef: innerArtefactDiagramRef,
  routedCrossPackageBridgeRelations: () => routedCrossPackageBridgeRelations.value,
  crossPackageBoundaryStubRelations: () => crossPackageBoundaryStubRelations.value,
  innerArtefactRelationList: () => innerArtefactRelationList.value,
  updateScrollMetrics: updateInnerScrollMetrics,
})

watch(innerArtefactDiagramRef, observeInnerArtefactDiagram)

watch(rootEl, observeInnerArtefactHost, { flush: 'post' })

watch(
  () => [
    props.innerArtefacts,
    props.innerArtefactRelations,
    props.crossArtefactRelations,
    props.innerPackages,
    innerDrillPathArr.value,
    props.focused,
  ],
  () => void nextTick(() => scheduleInnerEdgeRefresh()),
  { deep: true },
)

watch(
  () => props.focusedInnerArtefactId,
  () => void scheduleInnerEdgeRefreshSettled(),
)

watch(
  () => props.focused,
  (focused) => {
    if (focused && props.innerArtefacts.length > 0) void scheduleInnerEdgeRefreshSettled()
  },
)

watch(innerArtefactLayerColumns, () => void nextTick(() => scheduleInnerEdgeRefresh()), { deep: true })

watch(innerDrillPathArr, (p, prev) => {
  if (prev && prev.length > 0 && p.length === 0 && props.innerArtefacts.length > 0) {
    void scheduleInnerEdgeRefreshSettled()
  }
})

watch(crossPackagePreviewActive, () => void nextTick(() => scheduleInnerEdgeRefreshSettled()))

watch(focusRelationDepthRef, () => void nextTick(() => scheduleInnerEdgeRefreshSettled()))

watch(
  () => nodeTypeVisibilityRef.value,
  () => {
    void nextTick(() => {
      scheduleInnerEdgeRefreshSettled()
      emit('layout-update-request')
    })
  },
  { deep: true },
)

watch(innerDiagramColsRef, () => void nextTick(() => updateInnerScrollMetrics()))

watch([innerArtefactLayerColumns, () => props.focusedInnerArtefactId], () => {
  resetInnerScroll()
})

const { editing, draftLabel, draftDescription, startEditing, commitEdit, cancelEdit } = useEditableBox({
  label: () => props.label,
  description: () => props.description,
  canEdit: () => !props.embedded && props.leafVisual !== 'artefact',
  onRename: (label) => emit('rename', label),
  onDescriptionChange: (description) => emit('description-change', description),
})

/** Header dblclick on a Scala-leaf renders read-only chrome — no rename/description modal. */
function onHeaderDblClick() {
  if (props.leafVisual === 'artefact') return
  startEditing()
}
</script>

<template>
  <!--
    Inner-diagram package tiles: same compact header as the layer-drill root
    ({@link GeneralFocusedBox} — folder + title + subtitle row), not the unfocused
    centered tall-folder card.
  -->
  <div
    v-if="embedded"
    ref="rootEl"
    class="package-box package-box--embedded package-box--embedded-compact-header"
    :class="{
      'package-box--embedded-expanded': !!$slots.default,
      'package-box--pinned': pinned,
      'package-box--has-metrics': true,
      'package-box--metrics-break': metricsBreakLayout,
      'package-box--superslim-layout': superslimLayout,
      'package-box--slim-layout': metricsBreakLayout && !superslimLayout && slimLayout,
    }"
    :style="{ '--box-accent': accent }"
  >
    <div class="package-box__metrics package-box__metrics--embedded">
      <BoxMetricStrip
        :coverage-percent="hasCoverage ? coveragePercentValue : null"
        :technical-debt-percent="simulatedMetrics.technicalDebtPercent"
        :issue-count="simulatedMetrics.issueCount"
        :issue-level="simulatedMetrics.issueLevel"
      />
    </div>
    <div
      class="package-box__embedded-header-row"
      :class="{
        'package-box__embedded-header-row--metrics-break': metricsBreakLayout,
        'package-box__embedded-header-row--superslim': superslimLayout,
        'package-box__embedded-header-row--slim': metricsBreakLayout && !superslimLayout && slimLayout,
      }"
    >
      <div class="package-box__embedded-folder">
        <img
          class="lang-svg folder-icon"
          :src="headerIconUrlForPackage"
          alt=""
          aria-hidden="true"
          decoding="async"
        />
      </div>
      <div
        ref="packageBodyEl"
        class="package-box__body package-box__body--embedded package-box__body--embedded-header"
        :class="{ 'triton-vertical-rail-container': superslimLayout || (metricsBreakLayout && slimLayout) }"
      >
        <div
          ref="titleEl"
          class="title title--header"
          :class="{
            'title--metrics-break-vertical':
              metricsBreakLayout && !superslimLayout && slimLayout,
            'triton-vertical-rail-text triton-vertical-title-rail':
              superslimLayout || (metricsBreakLayout && slimLayout),
          }"
        >
          {{ label }}
        </div>
        <div
          v-if="subtitle && !subtitleHiddenForVerticalTitle"
          class="subtitle subtitle--header"
          :class="{
            'triton-vertical-rail-text triton-vertical-subtitle-rail':
              superslimLayout || (metricsBreakLayout && slimLayout),
          }"
        >
          <MarkdownActionSubtitle
            v-if="packageSubtitleLinkText"
            :text="packageSubtitleLinkText"
            @link-action="emit('link-action', $event)"
          />
          <template v-else>{{ subtitle }}</template>
        </div>
      </div>
    </div>
    <div v-if="$slots.default" class="package-box__embedded-inner-diagram" @click.stop>
      <slot />
    </div>
  </div>

  <!--
    Layer-drill focused root: shared box chrome (accent strip, focus outline, padding,
    tools cluster, tight layout, transitions) for both Scala packages and Scala artefact leaves.
    Artefact-specific content is injected via slots so {@link ScalaArtefactBox} can reuse this shell
    without duplicating chrome — see `focused-tools-prefix`, `focused-header-icon`, `focused-body`.
  -->
  <div v-else-if="focused && !crossPackageFocused" class="package-box-host">
    <GeneralFocusedBox
      :accent="accent"
      :title="focusedPackageTitle"
      :subtitle="focusedPackageSubtitle"
      :inner-diagram-host="innerDiagramDescendant || nodeHasInnerDiagramPayload"
      :allow-overflow="true"
      :title-tooltip="isScalaLeaf ? String(label ?? '') : 'Double-click to rename / edit description'"
      :pinned="pinned"
      :show-pin-tool="showPinTool"
      :show-color-tool="showColorTool"
      :has-coverage="hasCoverage"
      :coverage-percent="coveragePercentValue"
      :technical-debt-percent="simulatedMetrics.technicalDebtPercent"
      :issue-count="simulatedMetrics.issueCount"
      :issue-level="simulatedMetrics.issueLevel"
      :pin-title="
        isScalaLeaf
          ? 'Pin — keep this declaration highlighted when another box is zoomed'
          : 'Pin — keep this package highlighted when another box is zoomed'
      "
      :pin-aria-label="
        isScalaLeaf
          ? 'Pin declaration (stays focused when zooming elsewhere)'
          : 'Pin package (stays focused when zooming elsewhere)'
      "
      @toggle-pin="emit('toggle-pin', $event)"
      @cycle-color="emit('cycle-color')"
      @header-dblclick="onHeaderDblClick"
    >
    <template #tools-prefix>
      <slot name="focused-tools-prefix" />
    </template>
    <template #header-icon>
      <slot name="focused-header-icon">
        <div class="lang-icon-slot lang-icon-slot--header">
          <img
            class="lang-svg folder-icon"
            :src="headerIconUrlForPackage"
            alt=""
            aria-hidden="true"
            decoding="async"
          />
        </div>
      </slot>
    </template>
    <template #subtitle>
      <!--
        Scala declaration header is a click-to-open target — clicking jumps the user's
        editor to the row where this artefact is declared. We render a <button> wrapper
        only for Scala leaves (plain packages don't have a source-file anchor), and only
        when the caller actually wants it (the emit is a no-op for listeners that aren't
        attached). `tabindex="-1"` keeps the focused-box keyboard flow unchanged; the tool
        button in the header still owns the primary Tab target.
      -->
      <button
        v-if="isScalaLeaf && declaration"
        type="button"
        class="subtitle__open-btn"
        :title="'Click to open this declaration in the editor'"
        tabindex="-1"
        @click.stop="emit('declaration-click')"
      >
        <ShikiInlineCode :code="declaration" lang="scala" />
      </button>
      <MarkdownActionSubtitle
        v-else-if="packageSubtitleLinkText"
        :text="packageSubtitleLinkText"
        @link-action="emit('link-action', $event)"
      />
      <template v-else>{{ focusedPackageSubtitle }}</template>
    </template>
      <slot name="focused-body">
        <div
          v-if="hasInnerDiagram"
          class="package-box__inner-diagram nodrag nopan"
          @pointerdown.stop
          @wheel.stop
          @click.self="clearInnerDrill"
        >
        <div
          v-if="innerDrillPathArr.length"
          class="package-box__inner-drill-toolbar"
          @pointerdown.stop
          @click.stop
        >
          <button type="button" class="inner-drill-btn" @click.stop="clearInnerDrill">All packages</button>
          <button
            v-if="innerDrillPathArr.length > 1"
            type="button"
            class="inner-drill-btn"
            @click.stop="innerDrillBackOne"
          >
            Back
          </button>
        </div>

        <PackageInnerDiagram
          v-if="innerArtefactLayerColumns.length || topLevelInnerPackages.length"
          mode="focused"
          :edge-marker-id="innerEdgeMarkerId"
          :top-level-inner-packages="topLevelInnerPackages"
          :top-level-inner-package-columns="topLevelInnerPackageColumns"
          :expanded-inner-package-id="drilledInnerPackageId"
          :inner-artefact-layer-columns="innerArtefactLayerColumns"
          :focused-inner-artefact-id="focusedInnerArtefactId"
          :inner-artefact-focus-active="innerArtefactFocusActive"
          :notes="notes"
          :normal-inner-edge-draws="normalInnerEdgeDraws"
          :emphasized-inner-edge-draws="emphasizedInnerEdgeDraws"
          :routed-overlay-inner-edge-draws="routedOverlayInnerEdgeDraws"
          :cross-package-external-endpoints="crossPackageExternalEndpoints"
          :child-package-ports-by-id="childPackagePortsById"
          :root-package-ports-left="rootPackagePortsLeft"
          :root-package-ports-right="rootPackagePortsRight"
          :inner-scroll-x="innerScrollX"
          :inner-scroll-y="innerScrollY"
          :root-el-ref="bindInnerArtefactDiagramEl"
          :cols-el-ref="bindInnerDiagramColsEl"
          :bind-slot-el="bindInnerArtefactSlotEl"
          :edge-emphasized="innerEdgeEmphasized"
          :edge-label-style-for="innerEdgeLabelSvgStyleFor"
          :artefact-emphasized="innerArtefactEmphasized"
          :artefact-cell="innerArtefactCell"
          :artefact-accent="innerArtefactAccent"
          :artefact-pinned="isInnerArtefactPinned"
          :artefact-has-coverage="innerHasCoverage"
          :artefact-coverage-percent="innerCoveragePercentValue"
          :artefact-metrics="innerSimulatedMetrics"
          :can-open-artefact-in-editor="canOpenInnerArtefactInEditor"
          :handle-wheel="onInnerWheel"
          :handle-pointer-down="onInnerPointerDown"
          :handle-inner-card-click="onInnerCardClick"
          :handle-artefact-row-click="onArtefactRowClick"
          :handle-focused-artefact-background-click="onFocusedArtefactBackgroundClick"
          :handle-artefact-toggle-pin="onInnerArtefactTogglePin"
          :handle-artefact-cycle-color="onInnerArtefactCycleColor"
          :handle-open-artefact-in-editor="openInnerArtefactInEditor"
          :handle-package-link-action="(href: string) => emit('link-action', href)"
          :handle-edge-enter="onInnerEdgeEnter"
          :handle-edge-leave="onInnerEdgeLeave"
          :handle-artefact-slot-enter="onInnerArtefactSlotEnter"
          :handle-artefact-slot-leave="onInnerArtefactSlotLeave"
        >
          <template #scroll-rails>
            <InnerDiagramScrollRails
              :horizontal-needed="innerHScrollNeeded"
              :vertical-needed="innerVScrollNeeded"
              :horizontal-ratio="innerHScrollRatio"
              :vertical-ratio="innerVScrollRatio"
              :horizontal-thumb-style="innerHThumbStyle"
              :vertical-thumb-style="innerVThumbStyle"
              :on-horizontal-input="onInnerHSliderInput"
              :on-vertical-input="onInnerVSliderInput"
            />
          </template>
        </PackageInnerDiagram>

      </div>

        <div v-else class="package-box__focused-legacy">
          <BoxCompartments :compartments="focusedLegacyCompartments" variant="dense" />
        </div>
      </slot>
    </GeneralFocusedBox>

    <BoxEditDialog
      v-if="editing"
      class="package-box__editor nodrag nopan"
      dialog-label="Edit package"
      description-placeholder="Describe what this package contains (included in the generated AI prompt)..."
      v-model:model-value-label="draftLabel"
      v-model:model-value-description="draftDescription"
      @save="commitEdit"
      @cancel="cancelEdit"
    />
  </div>

  <!-- Default (unfocused top-level): centered folder icon + title block. -->
  <div
    v-else
    ref="rootEl"
    class="package-box"
    :class="{
      'package-box--flat-layout': flatLayout,
      'package-box--superflat-layout': superflatLayout,
      'package-box--compact-layout': compactLayout,
      'package-box--tight': tightLayout,
      'package-box--scala-leaf': isScalaLeaf,
      'package-box--pinned': pinned,
      'package-box--tools-wide': showColorTool,
      'package-box--pin-only': showPinTool && !showColorTool,
      'package-box--editing': editing,
      'package-box--has-metrics': true,
      'package-box--cross-preview': crossPackagePreviewActive,
      'package-box--metrics-break': metricsBreakLayout,
      'package-box--superslim-layout': superslimLayout,
      'package-box--slim-layout': metricsBreakLayout && !superslimLayout && slimLayout,
    }"
    :style="{ '--box-accent': accent }"
  >
    <div class="package-box__metrics">
      <BoxMetricStrip
        :coverage-percent="hasCoverage ? coveragePercentValue : null"
        :technical-debt-percent="simulatedMetrics.technicalDebtPercent"
        :issue-count="simulatedMetrics.issueCount"
        :issue-level="simulatedMetrics.issueLevel"
      />
    </div>
    <BoxToolbar
      class="package-box__tools"
      :accent="accent"
      :pinned="pinned"
      :show-pin-tool="showPinTool"
      :show-color-tool="showColorTool"
      :pin-title="
        isScalaLeaf
          ? 'Pin — keep this declaration highlighted when another box is zoomed'
          : 'Pin — keep this package highlighted when another box is zoomed'
      "
      :pin-aria-label="
        isScalaLeaf
          ? 'Pin declaration (stays highlighted when zooming elsewhere)'
          : 'Pin package (stays focused when zooming elsewhere)'
      "
      @toggle-pin="emit('toggle-pin', $event)"
      @cycle-color="emit('cycle-color')"
    />

    <div
      class="package-box__chrome-row"
      :class="{ 'package-box__chrome-row--cross-inline': crossPackagePreviewActive }"
    >
      <div class="lang-icon-slot" :class="{ 'lang-icon-slot--scala-leaf': isScalaLeaf }">
        <KindBadge
          v-if="isScalaLeaf && kindBadgeForLeafArtefact(subtitle)"
          :text="kindBadgeForLeafArtefact(subtitle)!"
          :title="subtitle ?? ''"
          :accent="accent"
        />
        <img
          v-else
          class="lang-svg"
          :class="isScalaLeaf ? 'scala-leaf-icon' : 'folder-icon'"
          :src="headerIconUrlForPackage"
          :alt="isScalaLeaf ? (subtitle ?? '') : ''"
          aria-hidden="true"
          decoding="async"
        />
      </div>

      <div
        ref="packageBodyEl"
        class="package-box__body"
        :class="{ 'triton-vertical-rail-container': superslimLayout || (metricsBreakLayout && slimLayout) }"
        @dblclick.stop="startEditing"
      >
        <div
          ref="titleEl"
          class="title"
          :class="{
            'title--metrics-break-vertical':
              metricsBreakLayout && !superslimLayout && slimLayout,
            'triton-vertical-rail-text triton-vertical-title-rail':
              superslimLayout || (metricsBreakLayout && slimLayout),
          }"
          :title="
            superslimLayout || (metricsBreakLayout && slimLayout)
              ? undefined
              : isScalaLeaf
                ? String(label ?? '')
                : 'Double-click to rename / edit description'
          "
        >
          {{ label }}
        </div>
        <div
          v-if="subtitle && !subtitleHiddenForVerticalTitle"
          class="subtitle"
          :class="{
            'triton-vertical-rail-text triton-vertical-subtitle-rail':
              superslimLayout || (metricsBreakLayout && slimLayout),
          }"
        >
          <MarkdownActionSubtitle
            v-if="packageSubtitleLinkText"
            :text="packageSubtitleLinkText"
            @link-action="emit('link-action', $event)"
          />
          <template v-else>{{ subtitle }}</template>
        </div>
        <div
          v-if="
            !isScalaLeaf &&
            description &&
            !tightLayout &&
            !flatLayout &&
            !compactLayout &&
            !superslimLayout &&
            !(metricsBreakLayout && slimLayout)
          "
          class="description-preview"
          :title="description"
        >
          {{ description }}
        </div>
      </div>
    </div>

    <!-- Cross-package focus preview: show full inner diagram when a connected artefact elsewhere is focused -->
    <PackageInnerDiagram
      v-if="crossPackagePreviewActive && innerArtefactLayerColumns.length"
      mode="cross-preview"
      class="nodrag nopan"
      :edge-marker-id="innerEdgeMarkerId"
      :top-level-inner-packages="topLevelInnerPackages"
      :inner-artefact-layer-columns="innerArtefactLayerColumns"
      :focused-inner-artefact-id="focusedInnerArtefactId"
      :inner-artefact-focus-active="false"
      :notes="notes"
      :normal-inner-edge-draws="normalInnerEdgeDraws"
      :emphasized-inner-edge-draws="[]"
      :routed-overlay-inner-edge-draws="[]"
      :cross-package-external-endpoints="crossPackageExternalEndpoints"
      :child-package-ports-by-id="childPackagePortsById"
      :root-package-ports-left="[]"
      :root-package-ports-right="[]"
      :inner-scroll-x="0"
      :inner-scroll-y="0"
      :root-el-ref="bindInnerArtefactDiagramEl"
      :bind-slot-el="bindInnerArtefactSlotEl"
      :edge-emphasized="innerEdgeEmphasized"
      :edge-label-style-for="innerEdgeLabelSvgStyleFor"
      :artefact-emphasized="innerArtefactEmphasized"
      :artefact-cell="innerArtefactCell"
      :artefact-accent="innerArtefactAccent"
      :artefact-pinned="isInnerArtefactPinned"
      :artefact-has-coverage="innerHasCoverage"
      :artefact-coverage-percent="innerCoveragePercentValue"
      :artefact-metrics="innerSimulatedMetrics"
      :can-open-artefact-in-editor="canOpenInnerArtefactInEditor"
      :handle-wheel="onInnerWheel"
      :handle-pointer-down="onInnerPointerDown"
      :handle-inner-card-click="onInnerCardClick"
      :handle-artefact-row-click="onArtefactRowClick"
      :handle-focused-artefact-background-click="onFocusedArtefactBackgroundClick"
      :handle-artefact-toggle-pin="onInnerArtefactTogglePin"
      :handle-artefact-cycle-color="onInnerArtefactCycleColor"
      :handle-open-artefact-in-editor="openInnerArtefactInEditor"
      :handle-package-link-action="(href: string) => emit('link-action', href)"
      :handle-edge-enter="onInnerEdgeEnter"
      :handle-edge-leave="onInnerEdgeLeave"
      :handle-artefact-slot-enter="onInnerArtefactSlotEnter"
      :handle-artefact-slot-leave="onInnerArtefactSlotLeave"
    />

    <BoxEditDialog
      v-if="editing"
      class="package-box__editor nodrag nopan"
      :dialog-label="isScalaLeaf ? 'Edit box' : 'Edit package'"
      description-placeholder="Describe what this package contains (included in the generated AI prompt)..."
      v-model:model-value-label="draftLabel"
      v-model:model-value-description="draftDescription"
      @save="commitEdit"
      @cancel="cancelEdit"
    />
  </div>
</template>

<style scoped>
.package-box-host {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}

/*
 * Styles parallel ProjectBox; class names are namespaced (`package-box*`) so the two components
 * can drift independently without leaking selectors. If common styling between the two starts to
 * feel duplicated, lift the shared parts into a `_box.scss` partial — but only after we know what
 * actually wants to diverge.
 */
.package-box {
  --box-accent: steelblue;
  /**
   * Body fill is a very light wash of the accent strip so packages, Scala leaves, and
   * inner artefact rows all share the same family-color identity (not just the strip).
   * The 90% alpha keeps every box slightly translucent so dependency / inheritance edges
   * routed under a box stay faintly visible through it.
   */
  --box-fill: color-mix(in srgb, var(--box-accent) 8%, #ffffff);
  --triton-package-box-pad-x: clamp(6px, 1.35vmin, 14px);
  --triton-package-box-pad-y: clamp(6px, 1.2vmin, 14px);
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  container-type: size;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  padding: var(--triton-package-box-pad-y) var(--triton-package-box-pad-x);
  padding-right: var(--triton-package-box-pad-x);
  border-radius: 8px;
  border: 1px solid rgb(30 41 59 / 0.88);
  background: color-mix(in srgb, var(--box-fill) 90%, transparent);
  box-shadow: inset 5px 0 0 0 var(--box-accent), 0 1px 2px rgb(15 23 42 / 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
  transition:
    padding 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.45s ease,
    outline 0.45s ease;
}

/** Layer-drill root may still animate chrome; default cards skip padding animation to avoid ResizeObserver ↔ measure loops. */
.package-box:not(.package-box--focused-layout) {
  transition: box-shadow 0.45s ease, outline 0.45s ease;
}

/**
 * Cross-package focus preview: layout computes a preferred package footprint first; the inner
 * diagram then renders inside the node allocation instead of expanding the node after paint.
 */
.package-box--cross-preview {
  height: 100%;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
/** Tighter top chrome than default unfocused cards — parity with {@link GeneralFocusedBox} header band. */
.package-box--cross-preview.package-box--has-metrics {
  padding-top: clamp(10px, 2.2vmin, 16px);
}
.package-box--cross-preview.package-box--has-metrics.package-box--metrics-break {
  padding-top: clamp(24px, 5vmin, 36px);
}
/**
 * Default: wrapper is layout-transparent so existing column chrome (metrics, tools, icon, body)
 * behaves unchanged. Cross-preview: one horizontal strip (folder | titles) above the inner diagram.
 */
.package-box__chrome-row:not(.package-box__chrome-row--cross-inline) {
  display: contents;
}
.package-box__chrome-row--cross-inline {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  flex: 0 0 auto;
  flex-shrink: 0;
  min-width: 0;
  gap: 10px;
  padding-top: 0;
  padding-bottom: 4px;
  /** Clears absolute metric strip (same inset as {@link GeneralFocusedBox} `__header`). */
  padding-right: clamp(44px, 10cqw, 104px);
}
.package-box__chrome-row--cross-inline .lang-icon-slot {
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  align-self: flex-start;
  height: 34px;
  min-height: 34px;
  max-height: 34px;
  margin-bottom: 0;
  margin-right: 0;
  justify-content: flex-start;
}
.package-box__chrome-row--cross-inline .lang-icon-slot :deep(.lang-svg),
.package-box__chrome-row--cross-inline .lang-icon-slot :deep(svg) {
  height: 34px;
  max-height: 34px;
  max-width: 34px;
  width: auto;
}
.package-box__chrome-row--cross-inline .package-box__body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  align-items: flex-start;
  justify-content: flex-start;
  text-align: left;
}
.package-box__chrome-row--cross-inline .title,
.package-box__chrome-row--cross-inline .subtitle {
  text-align: left;
  align-self: stretch;
}
.package-box__chrome-row--cross-inline .title {
  font-size: clamp(0.82rem, min(2.4vmin, 3.8cqh), 1.45rem);
  line-height: 1.15;
}
.package-box__chrome-row--cross-inline .subtitle {
  font-size: clamp(0.65rem, min(1.45vmin, 2.2cqh), 0.85rem);
  line-height: 1.2;
  color: #475569;
  margin-top: 0;
}
.package-box--cross-preview > .package-box__inner-artefact-diagram {
  flex: 1 1 0;
  min-height: 0;
  width: calc(100% + 2 * var(--triton-package-box-pad-x, 0px));
  margin-inline: calc(-1 * var(--triton-package-box-pad-x, 0px));
  margin-bottom: calc(-1 * var(--triton-package-box-pad-y, 0px));
}
/**
 * Scala leaf chrome is intentionally identical to a package card here — same left accent
 * strip (inset shadow), same border, same drop shadow. The two diverge only in the icon
 * (scala glyph vs folder) and the editing affordance (no rename/desc dialog for a Scala
 * leaf). Keeping the box-shadow definition aligned makes it impossible for the strip to
 * silently disappear after package-side tweaks.
 */

.package-box:not(.package-box--focused-layout) .title,
.package-box:not(.package-box--focused-layout) .subtitle {
  transition: none;
}

.package-box--pin-only {
  padding-right: clamp(34px, 6.5cqw, 44px);
}

.package-box--tools-wide {
  padding-right: clamp(72px, 12cqw, 108px);
}

/**
 * Metrics + pin/color tools sit in an absolute top-right cluster — keep root horizontal padding
 * symmetric (see base `.package-box`) so the icon + title column stays visually centered; extra
 * `padding-right` here used to shrink the stack and pulled centered text toward the left edge.
 */
.package-box--has-metrics {
  padding-top: clamp(16px, 3.8vmin, 24px);
}

.package-box--has-metrics.package-box--metrics-break {
  padding-top: clamp(36px, 7.5vmin, 52px);
}
/**
 * Tight (narrow vertical) boxes: coverage bar lives in the top-right corner, but reserving
 * 46–56px of right-padding on a ~87px-wide box would shrink the centered folder icon to
 * 30–40px and push it visually left. Drop the right-pad here and reserve vertical space at
 * the top instead — the icon stays its original size and re-centers below the bar.
 */
.package-box--tight.package-box--has-metrics,
.package-box--tight.package-box--has-metrics.package-box--pin-only,
.package-box--tight.package-box--has-metrics.package-box--tools-wide {
  padding-right: clamp(4px, 1vmin, 10px);
  padding-top: clamp(36px, 7.5vmin, 52px);
}

/**
 * Focused package + inner diagram: pin/color tools are `position: absolute` in the top-right.
 * The global `--tools-wide` / `--pin-only` padding-right shrinks the whole content column, so
 * embedded cards stop short of the node edge (gap vs. Vue Flow’s blue selection outline). Keep
 * symmetric padding on the root and reserve horizontal space only on the header row so the title
 * clears the floating buttons while `package-box__inner-diagram` spans the full usable width.
 */
.package-box--focused-layout.package-box--tools-wide,
.package-box--focused-layout.package-box--pin-only {
  padding-right: clamp(6px, 1.35vmin, 14px);
}

/** Matches {@link ProjectBox} `.project-box__metrics` — fixed top-right on the box frame. */
.package-box__metrics {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 4;
  width: min(124px, calc(100% - 2px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  box-sizing: border-box;
}

/** Same corner contract as {@link ProjectBox} `.project-box__metrics` (general box). */
.package-box__metrics--embedded {
  top: 1px;
  right: 1px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  box-sizing: border-box;
}

.lang-icon-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: stretch;
  flex-shrink: 0;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: clamp(40px, min(30cqw, 28cqh), 160px);
  min-height: 36px;
  margin-bottom: clamp(6px, 1.5cqh, 16px);
  transform: none;
  pointer-events: none;
}

.package-box--has-metrics .package-box__tools {
  top: 17px;
}
.package-box--has-metrics.package-box--metrics-break .package-box__tools {
  top: 40px;
}

/**
 * Narrow width: metric strip stacks — pin folder / Scala badge top-left (same `top: 1px` as
 * `.package-box__metrics`), keep strip top-right. Skip wide-shallow / ultra-compact header modes.
 */
.package-box--has-metrics.package-box--metrics-break:not(.package-box--flat-layout)
  .lang-icon-slot:not(.lang-icon-slot--header):not(.lang-icon-slot--artefact) {
  position: absolute;
  top: 1px;
  left: 1px;
  z-index: 15;
  align-self: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  width: auto;
  min-height: 40px;
  height: 44px;
  max-height: 48px;
  margin: 0;
}

.package-box--has-metrics.package-box--metrics-break:not(.package-box--flat-layout):not(
    .package-box--focused-layout
  )
  .package-box__body {
  justify-content: flex-start;
  position: relative;
  z-index: 0;
}

.package-box--has-metrics.package-box--metrics-break:not(.package-box--flat-layout)
  .lang-icon-slot:not(.lang-icon-slot--header):not(.lang-icon-slot--artefact)
  :deep(.lang-svg),
.package-box--has-metrics.package-box--metrics-break:not(.package-box--flat-layout)
  .lang-icon-slot:not(.lang-icon-slot--header):not(.lang-icon-slot--artefact)
  :deep(svg) {
  height: 40px;
  max-height: 40px;
  width: auto;
}

.package-box--embedded.package-box--metrics-break .package-box__body--embedded {
  justify-content: flex-start;
}

/** Embedded compact header: metrics-break positions folder like {@link GeneralFocusedBox}. */
.package-box--embedded.package-box--has-metrics.package-box--metrics-break .package-box__embedded-folder {
  position: absolute;
  top: 1px;
  left: 1px;
  z-index: 15;
  align-items: flex-start;
  justify-content: flex-start;
  width: auto;
  height: clamp(32px, min(20cqw, 14cqh), 48px);
  min-height: 32px;
}

.package-box--embedded.package-box--has-metrics.package-box--metrics-break
  .package-box__embedded-folder
  :deep(.lang-svg),
.package-box--embedded.package-box--has-metrics.package-box--metrics-break .package-box__embedded-folder :deep(svg) {
  height: clamp(28px, min(18cqw, 12cqh), 40px);
  max-height: 40px;
  width: auto;
}

.package-box--embedded.package-box--has-metrics.package-box--metrics-break .package-box__body--embedded-header {
  padding-left: clamp(40px, 12cqw, 52px);
}

.package-box--embedded.package-box--metrics-break .package-box__embedded-header-row--metrics-break {
  align-items: flex-start;
  padding-top: clamp(2px, 0.5vmin, 6px);
}

.package-box--has-metrics.package-box--metrics-break:not(.package-box--flat-layout):not(
    .package-box--focused-layout
  )
  .package-box__body
  > .title,
.package-box--has-metrics.package-box--metrics-break:not(.package-box--flat-layout):not(
    .package-box--focused-layout
  )
  .package-box__body
  > .subtitle,
.package-box--has-metrics.package-box--metrics-break:not(.package-box--flat-layout):not(
    .package-box--focused-layout
  )
  .package-box__body
  > .description-preview {
  text-align: left;
}

.package-box--embedded.package-box--metrics-break .title,
.package-box--embedded.package-box--metrics-break .subtitle {
  text-align: left;
}

/**
 * Superslim: subtitle hidden in script — keep metrics + tools pinned top-right (same as wide
 * break); reserve vertical space for the floating strip instead of in-flow stacking.
 */
.package-box--has-metrics.package-box--metrics-break.package-box--superslim-layout {
  padding-top: clamp(36px, 7.5vmin, 52px);
}

/**
 * Side-by-side chrome: when the body is taller than it is wide, title + subtitle use vertical
 * rails; otherwise they stay horizontal under the logo/metrics row.
 */
.package-box--slim-layout:not(.package-box--superslim-layout) .package-box__body,
.package-box--embedded.package-box--slim-layout:not(.package-box--superslim-layout)
  .package-box__body--embedded {
  width: 100%;
}

.package-box--slim-layout:not(.package-box--superslim-layout):not(.package-box--scala-leaf)
  .package-box__body {
  --triton-vertical-title-rail-shift-y: 3px;
}

.package-box--slim-layout:not(.package-box--superslim-layout) .package-box__body > .subtitle {
  pointer-events: none;
}

.lang-icon-slot :deep(svg),
.lang-icon-slot :deep(.lang-svg) {
  display: block;
  height: min(100%, 36cqw);
  width: auto;
  max-height: 100%;
  max-width: min(92cqw, 240px);
}

/**
 * Tight = narrow column: keep folder readable via `cqh` (not `cqw`), stack **icon on top centered**
 * and **vertical title below**; title may draw upward over the icon for a compact footprint.
 */
.package-box--tight {
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  padding-top: clamp(4px, 1vmin, 10px);
  padding-bottom: clamp(4px, 1vmin, 10px);
}
.package-box--tight .lang-icon-slot {
  transform: none;
  align-self: center;
  width: 100%;
  flex: 0 0 auto;
  flex-shrink: 0;
  height: auto;
  min-height: clamp(28px, 26cqh, 44px);
  max-height: min(44cqh, 52px);
  margin-bottom: 0;
  margin-right: 0;
  justify-content: center;
  z-index: 0;
}
.package-box--tight .lang-icon-slot :deep(.lang-svg) {
  height: clamp(26px, min(34px, 34cqh), 42px);
  width: auto;
  max-height: min(100%, 40cqh);
  max-width: min(100%, 56px);
}
.package-box--tight .package-box__body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  width: 100%;
  justify-content: center;
  align-items: center;
  margin-top: clamp(-16px, -4cqh, -6px);
  position: relative;
  z-index: 1;
}

/** Unfocused flat node: icon column left, title/subtitle stack right (LR layout). */
.package-box--flat-layout {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  padding-top: 2px;
  padding-bottom: 2px;
}

.package-box--has-metrics.package-box--flat-layout {
  padding-top: 12px;
  padding-bottom: 2px;
}

.package-box--flat-layout .lang-icon-slot {
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  align-self: center;
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  margin-bottom: 0;
  margin-right: 8px;
  justify-content: center;
}
.package-box--flat-layout .lang-icon-slot :deep(.lang-svg) {
  height: 40px;
  max-height: 40px;
  max-width: 40px;
  width: auto;
}
.package-box--flat-layout .package-box__body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  align-items: flex-start;
  justify-content: center;
  text-align: left;
}
.package-box--flat-layout .title {
  text-align: left;
  align-self: stretch;
}
.package-box--flat-layout .subtitle {
  text-align: left;
  align-self: stretch;
  max-height: 2.8em;
  line-height: 1.05;
}

.package-box--flat-layout .title {
  line-height: 1.05;
}

.package-box__body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  box-sizing: border-box;
}

.package-box--superflat-layout {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  padding: 0;
}

.package-box--has-metrics.package-box--superflat-layout {
  padding: 0;
}

.package-box--superflat-layout .lang-icon-slot {
  width: 40px;
  min-width: 40px;
  flex: 0 0 auto;
  align-self: stretch;
  align-items: stretch;
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  margin: 0;
  justify-content: flex-start;
}

.package-box--superflat-layout .lang-icon-slot :deep(.lang-svg) {
  height: 40px;
  width: 40px;
  max-height: 40px;
  max-width: 40px;
}

.package-box--superflat-layout .package-box__body {
  align-items: flex-start;
  justify-content: center;
  text-align: left;
  gap: 0;
}

.package-box--superflat-layout .title,
.package-box--superflat-layout .subtitle {
  text-align: left;
  align-self: stretch;
}

.package-box--superflat-layout .title,
.package-box--superflat-layout .subtitle {
  line-height: 1.05;
}

.package-box--compact-layout {
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding-top: 12px;
  padding-bottom: 8px;
}

.package-box--has-metrics.package-box--compact-layout {
  padding-top: 20px;
}

.package-box--compact-layout .lang-icon-slot {
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  align-self: center;
  height: 44px;
  min-height: 40px;
  max-height: 48px;
  margin-bottom: 2px;
  justify-content: center;
}

.package-box--compact-layout .lang-icon-slot :deep(.lang-svg) {
  height: 40px;
  max-height: 40px;
  width: auto;
}

.package-box--compact-layout .package-box__body {
  flex: 1 1 auto;
  min-height: 0;
  align-items: center;
  justify-content: flex-start;
  text-align: center;
  gap: 0;
}

.package-box--compact-layout .title {
  text-align: center;
  align-self: center;
  max-width: 100%;
  line-height: 1.1;
}

/**
 * Default / scala-leaf column: title + subtitle + description fill the body width and center
 * (same idea as {@link ProjectBox} — avoids shrink-wrapped lines sitting left of the icon).
 */
.package-box:not(.package-box--tight):not(.package-box--flat-layout):not(.package-box--focused-layout):not(
    .package-box--cross-preview
  )
  .package-box__body
  > .title,
.package-box:not(.package-box--tight):not(.package-box--flat-layout):not(.package-box--focused-layout):not(
    .package-box--cross-preview
  )
  .package-box__body
  > .subtitle,
.package-box:not(.package-box--tight):not(.package-box--flat-layout):not(.package-box--focused-layout):not(
    .package-box--cross-preview
  )
  .package-box__body
  > .description-preview {
  text-align: center;
  align-self: stretch;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.package-box--embedded .title,
.package-box--embedded .subtitle {
  align-self: stretch;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

/** Layer-drill focused root: header row + inner diagram (child packages). */
.package-box--focused-layout {
  justify-content: flex-start;
}
/** Tighter bottom than generic `.package-box` padding — inner diagram + embedded cards sit closer to the frame. */
.package-box.package-box--focused-layout {
  padding-bottom: clamp(2px, 0.35vmin, 6px);
}
.package-box__focused-shell {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 2px;
}
.package-box__focused-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-bottom: 8px;
  /** Clears absolutely positioned tool cluster (see `.package-box--focused-layout` padding note). */
  padding-right: clamp(44px, 10cqw, 104px);
}
.lang-icon-slot--header {
  width: 40px;
  height: 40px;
  margin: 0;
  flex-shrink: 0;
  align-self: flex-start;
}
.lang-icon-slot--header :deep(.lang-svg) {
  max-height: 34px;
}
.package-box__focused-head-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.title--header {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: left;
  writing-mode: horizontal-tb;
  transform: none;
  align-self: stretch;
}
.subtitle--header {
  margin-top: 0;
  font-size: clamp(0.65rem, min(1.45vmin, 2.2cqh), 0.85rem);
  text-align: left;
  opacity: 1;
  max-height: none;
  line-height: 1.25;
  color: #475569;
}
/**
 * The clickable declaration wrapper re-uses the subtitle typography — no chrome, no box —
 * so the user sees highlighted code, not a button shape. `cursor: pointer` and a subtle
 * hover underline are the only affordances; keeps the focused header visually calm.
 */
.subtitle__open-btn {
  all: unset;
  cursor: pointer;
  display: inline;
  text-align: left;
}
.subtitle__open-btn:hover :deep(.shiki-inline),
.subtitle__open-btn:focus-visible :deep(.shiki-inline) {
  text-decoration: underline;
  text-decoration-color: var(--box-accent, #3b82f6);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.subtitle__open-btn:focus-visible {
  outline: 2px solid var(--box-accent, #3b82f6);
  outline-offset: 1px;
  border-radius: 3px;
}
/**
 * Inner-diagram band hosts the focused package's child packages, artefact rows / cards, and
 * inheritance edges. The container is intentionally **invisible** — no background, no border —
 * so children space themselves against the surrounding `.package-box__focused-shell` (i.e. the
 * package box chrome). The earlier dashed frame + grey fill duplicated the package's own
 * border and made the spacing read as "padding around a sub-canvas" rather than "content
 * inside the package".
 */
.package-box__inner-diagram {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: calc(100% + 2 * var(--triton-focused-box-pad-x, 0px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  margin-inline: calc(-1 * var(--triton-focused-box-pad-x, 0px));
  padding: 0;
  border: 0;
  background: transparent;
  overflow: visible;
}
.package-box--focused-layout .package-box__inner-diagram {
  padding-bottom: 0;
}
.package-box__inner-slot {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: visible;
}
.package-box__inner-slot > .package-box {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  align-self: stretch;
}
.package-box__inner-slot--clickable {
  cursor: pointer;
}
.package-box__inner-slot--solo {
  flex: 3 1 0;
}

.package-box__inner-drill-toolbar {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.inner-drill-btn {
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgb(148 163 184 / 0.9);
  background: rgb(255 255 255 / 0.95);
  color: #334155;
  cursor: pointer;
}
.inner-drill-btn:hover {
  border-color: var(--box-accent, #64748b);
  color: #0f172a;
}
.package-box__inner-drill-fallback {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  font-size: 12px;
  color: #64748b;
}
.inner-drill-fallback-text {
  line-height: 1.4;
}
.package-box__focused-legacy {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/** Inner stack / drill row: fills slot; compact header variant matches layer-drill root chrome. */
.package-box--embedded {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 8px 10px 3px;
  justify-content: flex-start;
}
.package-box--embedded-compact-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  container-type: size;
  container-name: pkg-embedded;
}
.package-box--embedded-expanded {
  gap: 10px;
  padding-bottom: 10px;
}
.package-box__embedded-header-row {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  position: relative;
  /** Clears the metric strip cluster (same contract as {@link GeneralFocusedBox} header). */
  padding-right: clamp(44px, 10cqw, 104px);
}
.package-box--embedded-expanded .package-box__embedded-header-row {
  flex: 0 0 clamp(72px, 18cqh, 118px);
}
.package-box__embedded-inner-diagram {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 10px;
  overflow: visible;
}
.package-box__embedded-folder {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}
.package-box__embedded-folder :deep(.lang-svg),
.package-box__embedded-folder :deep(svg) {
  display: block;
  width: 34px;
  height: 34px;
  max-width: 34px;
  max-height: 34px;
  object-fit: contain;
}
.package-box__body--embedded {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  align-self: stretch;
  justify-content: center;
}
.package-box__body--embedded-header {
  justify-content: center;
  align-items: flex-start;
  text-align: left;
  gap: 2px;
}
.package-box--embedded-compact-header .title.title--header {
  text-align: left;
  margin-top: 0;
}
.package-box--embedded-compact-header .subtitle.subtitle--header {
  text-align: left;
  margin-top: 0;
}
@container pkg-embedded (max-width: 200px) {
  .package-box__embedded-folder :deep(.lang-svg),
  .package-box__embedded-folder :deep(svg) {
    width: 28px;
    height: 28px;
    max-width: 28px;
    max-height: 28px;
  }
}
@container pkg-embedded (max-height: 120px) {
  .package-box__embedded-header-row {
    gap: 6px;
  }
  .package-box__embedded-folder :deep(.lang-svg),
  .package-box__embedded-folder :deep(svg) {
    width: 26px;
    height: 26px;
    max-width: 26px;
    max-height: 26px;
  }
}

.drill-note {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgb(15 23 42 / 0.12);
  font-size: 10px;
  line-height: 1.45;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  overflow: auto;
  flex: 1;
  min-height: 0;
  text-align: left;
}
.package-box__tools {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 4;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 5px;
  max-width: calc(100% - 2px);
}

/**
 * Coverage indicator: slim horizontal split bar (green = covered, red = uncovered).
 * Mirrors the `assets/horizontal-bar.svg` reference but inlined so the green/red split
 * can move with a real coverage signal later. `flex-basis: 100%` forces it onto its own
 * row inside the tools cluster so the pin / color buttons (when present) wrap underneath
 * — keeps the chrome tidy regardless of which tools the box currently shows.
 */
.package-box__coverage {
  flex: 0 0 100%;
  width: 100%;
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgb(15 23 42 / 0.22);
  background: rgb(255 255 255 / 0.85);
  overflow: hidden;
  display: block;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
  pointer-events: auto;
  /** Bar wants a fixed visual width regardless of how wide the tools-cluster row is. */
  max-width: 36px;
  align-self: flex-end;
}
.package-box__coverage-svg {
  display: block;
  width: 100%;
  height: 100%;
}
.package-box__coverage-fill--covered {
  fill: #22c55e;
}
.package-box__coverage-fill--uncovered {
  fill: #ef4444;
}

/** Embedded inner-card: coverage bar is absolute so it stays visible even in tiny tiles. */
.package-box__coverage--embedded {
  position: absolute;
  top: 6px;
  right: 8px;
  max-width: 36px;
}
.package-box__coverage--inner-artefact {
  position: absolute;
  top: 6px;
  right: 8px;
  max-width: 34px;
  height: 8px;
  z-index: 3;
}
.package-box--embedded.package-box--has-coverage {
  /** Make sure the bar doesn't overlap the embedded icon row in very small tiles. */
  padding-top: 18px;
}
.package-box--pinned:not(.package-box--focused) {
  box-shadow:
    inset 5px 0 0 0 var(--box-accent),
    0 1px 2px rgb(15 23 42 / 0.08),
    0 0 0 1px rgb(30 41 59 / 0.1);
}
.tool-btn {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid rgb(15 23 42 / 0.22);
  background: rgb(255 255 255 / 0.92);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  color: rgb(51 65 85);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease, color 0.2s ease;
}
.tool-btn:hover {
  border-color: var(--box-accent);
  background: rgb(255 255 255 / 1);
  transform: scale(1.06);
}
.tool-btn:active {
  transform: scale(0.96);
}
.tool-btn--active {
  border-color: var(--box-accent);
  color: var(--box-accent);
  background: rgb(255 255 255 / 1);
}
.tool-btn__icon {
  width: 14px;
  height: 14px;
  display: block;
}
.tool-btn__icon--color {
  fill: var(--box-accent);
}
.tool-btn__icon--pin {
  fill: currentColor;
}
.title {
  font-weight: 600;
  font-size: 1.2rem;
  color: #0f172a;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  transition: none;
}
.subtitle {
  margin-top: clamp(2px, 0.6vmin, 8px);
  font-size: 0.92rem;
  color: #475569;
  line-height: 1.25;
  opacity: 1;
  max-height: 80px;
  overflow: hidden;
  transition: none;
}
.package-box--scala-leaf:not(.package-box--tight) .subtitle {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #64748b;
}
.package-box--focused {
  box-shadow:
    inset 8px 0 0 0 var(--box-accent),
    0 4px 22px rgb(15 23 42 / 0.14);
  outline: 2px solid var(--box-accent);
  outline-offset: 0;
}
.package-box--focused .title {
  font-size: clamp(0.82rem, min(2.4vmin, 3.8cqh), 1.45rem);
}
@container (max-width: 260px) {
  .package-box:not(.package-box--focused-layout):not(.package-box--tight):not(
      .package-box--slim-layout
    )
    .title {
    font-size: 1.08rem;
  }
  .package-box:not(.package-box--focused-layout):not(.package-box--tight):not(
      .package-box--slim-layout
    )
    .subtitle {
    font-size: 0.84rem;
  }
}
@container (max-width: 190px) {
  .package-box:not(.package-box--focused-layout):not(.package-box--tight):not(
      .package-box--slim-layout
    )
    .title {
    font-size: 0.96rem;
  }
  .package-box:not(.package-box--focused-layout):not(.package-box--tight):not(
      .package-box--slim-layout
    )
    .subtitle {
    font-size: 0.78rem;
  }
}
@container (max-height: 180px) {
  .package-box:not(.package-box--focused-layout):not(.package-box--tight):not(
      .package-box--slim-layout
    )
    .title {
    font-size: 1.04rem;
  }
  .package-box:not(.package-box--focused-layout):not(.package-box--tight):not(
      .package-box--slim-layout
    )
    .subtitle {
    font-size: 0.82rem;
  }
}
@container (max-height: 145px) {
  .package-box:not(.package-box--focused-layout):not(.package-box--tight):not(
      .package-box--slim-layout
    )
    .title {
    font-size: 0.94rem;
  }
  .package-box:not(.package-box--focused-layout):not(.package-box--tight):not(
      .package-box--slim-layout
    )
    .subtitle {
    font-size: 0.76rem;
  }
}
.package-box--tight .title {
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
  max-width: none;
  max-height: none;
  align-self: center;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  text-orientation: mixed;
  line-height: 1.15;
  position: relative;
  z-index: 1;
  pointer-events: none;
}
.package-box--tight .subtitle {
  opacity: 0;
  margin-top: 0;
  max-height: 0;
  transform: translateY(4px);
  pointer-events: none;
}
.description-preview {
  margin-top: clamp(2px, 0.5vmin, 6px);
  font-size: clamp(0.6rem, min(1.4vmin, 2.2cqh), 0.8rem);
  color: #64748b;
  line-height: 1.3;
  font-style: italic;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 2.6em;
}

.package-box--superslim-layout:not(.package-box--focused-layout) .package-box__body {
  width: 100%;
}

.package-box--superslim-layout:not(.package-box--focused-layout) .title {
  order: 0;
}

.package-box--superslim-layout:not(.package-box--focused-layout) .package-box__body > .subtitle {
  order: 1;
}

.package-box--superslim-layout:not(.package-box--focused-layout)
  .package-box__body
  > .description-preview {
  display: block;
  font-style: italic;
}
.description-full {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgb(15 23 42 / 0.12);
  font-size: 11px;
  line-height: 1.45;
  color: #334155;
  white-space: pre-wrap;
  overflow: auto;
  flex: 0 1 auto;
  min-height: 0;
  text-align: left;
  font-style: italic;
}
.package-box--editing {
  overflow: visible;
}
.package-box__editor {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 50;
  width: max(280px, 100%);
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid var(--box-accent);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgb(15 23 42 / 0.18), 0 2px 6px rgb(15 23 42 / 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
  cursor: auto;
  text-align: left;
}
.editor-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.editor-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  font-weight: 600;
}
.title-input {
  font-family: inherit;
  font-weight: 600;
  font-size: 14px;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 5px 8px;
  background: #fff;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.description-input {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  line-height: 1.45;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 6px 8px;
  background: #fff;
  outline: none;
  resize: vertical;
  min-height: 80px;
  max-height: 240px;
  width: 100%;
  box-sizing: border-box;
}
.description-input:focus,
.title-input:focus {
  border-color: var(--box-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--box-accent) 20%, transparent);
}
.editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.edit-hint {
  font-size: 10px;
  color: #94a3b8;
  font-style: italic;
  margin-right: auto;
}
.editor-btn {
  font-family: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: #f1f5f9;
  color: #0f172a;
  cursor: pointer;
}
.editor-btn:hover {
  background: #e2e8f0;
}
.editor-btn--primary {
  background: var(--box-accent);
  border-color: var(--box-accent);
  color: #fff;
}
.editor-btn--primary:hover {
  filter: brightness(0.95);
}
</style>
