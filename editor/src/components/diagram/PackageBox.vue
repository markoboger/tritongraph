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
import { computed, inject, nextTick, onMounted, onScopeDispose, onUnmounted, ref, watch, type Ref } from 'vue'
import { openInEditor } from '../../openInEditor'
import type {
  TritonInnerArtefactRelationSpec,
  TritonInnerArtefactSpec,
  TritonInnerPackageSpec,
} from '../../ilograph/types'
import { boxColorForId, nextNamedBoxColor, type NamedBoxColor } from '../../graph/boxColors'
import { dependencyEdgeLabelStyle } from '../../graph/edgeTheme'
import {
  SCALA_CREATES_STROKE,
  SCALA_EXTENDS_STROKE,
  SCALA_HAS_TRAIT_STROKE,
  SCALA_GETS_STROKE,
} from '../../graph/relationKinds'
import { assignInnerArtefactLayers } from '../../graph/innerArtefactLayerLayout'
import folderIconUrl from '../../assets/language-icons/folder.svg'
import scalaIconUrl from '../../assets/language-icons/scala.svg'
import scalaClassIconUrl from '../../assets/language-icons/scala-class.svg'
import scalaTraitIconUrl from '../../assets/language-icons/scala-trait.svg'
import scalaObjectIconUrl from '../../assets/language-icons/scala-object.svg'
import scalaEnumIconUrl from '../../assets/language-icons/scala-enum.svg'
import ShikiInlineCode from '../ShikiInlineCode.vue'
import GeneralFocusedBox from '../common/GeneralFocusedBox.vue'
import BoxMetricStrip from '../common/BoxMetricStrip.vue'
import { simulatedMetricsForBox } from '../common/boxMetricDemo'
import BoxCompartments from '../common/BoxCompartments.vue'
import { useScalaCoverageKeyed } from '../../store/useOverlay'
import { getScalaCoverage, onScalaCoverageChanged } from '../../store/overlayStore'
import type { BoxCompartment } from '../../diagram/boxCompartments'
import { shouldHideEdgeForRelationFilter } from '../../graph/relationVisibility'
import { buildAnchoredSmoothStepRelationDraws } from '../../graph/anchoredSmoothStepRelations'

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
import ScalaArtefactBox from './ScalaArtefactBox.vue'

export type InnerPackageSummary = TritonInnerPackageSpec
export type InnerArtefactSummary = TritonInnerArtefactSpec
export type InnerArtefactRelationSummary = TritonInnerArtefactRelationSpec

function findSpecAtPath(
  roots: readonly TritonInnerPackageSpec[],
  path: readonly string[],
): TritonInnerPackageSpec | null {
  let level: readonly TritonInnerPackageSpec[] = roots
  let found: TritonInnerPackageSpec | null = null
  for (const segment of path) {
    const hit = level.find((x) => x.id === segment)
    if (!hit) return null
    found = hit
    level = hit.innerPackages ?? []
  }
  return found
}

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
  },
)

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
  rename: [string]
  'description-change': [string]
  'update-inner-drill-path': [string[]]
  /** Toggle or clear inner artefact focus (`null` = clear only). */
  'update-inner-artefact-focus': [id: string | null]
  /** Replace the full inner-artefact pinned map (id → boolean). Caller stores into flow data. */
  'update-inner-artefact-pinned': [Record<string, boolean>]
  /** Replace the full inner-artefact accent-color map (id → color). Caller stores into flow data. */
  'update-inner-artefact-colors': [Record<string, string>]
  /**
   * Fired when the user clicks the Scala declaration line in the focused header. Parent
   * resolves it as an "open at the class declaration row" handoff — see
   * `ScalaArtefactBox` for the wiring; plain (non-Scala) callers can simply ignore this
   * event, the template only renders a clickable wrapper when `isScalaLeaf` is true.
   */
  'declaration-click': []
}>()

const accent = computed(() => (props.boxColor as string) || boxColorForId(props.boxId))

const focusedLegacyCompartments = computed<readonly BoxCompartment[]>(() => {
  const out: BoxCompartment[] = []
  if ((props.description ?? '').trim()) {
    out.push({
      id: 'purpose',
      title: 'Purpose',
      rows: [{ value: String(props.description ?? '') }],
    })
  }
  if ((props.notes ?? '').trim()) {
    out.push({
      id: 'notes',
      title: 'Notes',
      rows: [{ value: String(props.notes ?? '') }],
    })
  }
  return out
})

const isScalaLeaf = computed(() => props.leafVisual === 'artefact')

/**
 * `(root, dir)` of the tab's backing example — provided by `App.vue` so inner artefact cards
 * rendered inside a focused package can still translate their `sourceFile` + `sourceRow` into
 * an editor handoff. Absent for file-upload / builtin-example tabs (no disk anchor), in which
 * case the inner clicks are no-ops.
 */
const activeExampleRef = inject<Ref<{ root: string; dir: string } | null> | undefined>(
  'tritonActiveExample',
  undefined,
)

/**
 * Dispatch an "open in editor" handoff for an inner artefact card. The `artId` lets us pick
 * the matching `TritonInnerArtefactSpec` out of `innerArtefactCell(artId)` to recover the
 * `sourceFile` anchor; `line` is an optional 0-indexed override emitted by a per-method
 * click in the Methods panel (undefined → the artefact's own `sourceRow`).
 */
function openInnerArtefactInEditor(artId: string, line?: number): void {
  const ex = activeExampleRef?.value
  const cell = innerArtefactCell(artId)
  if (!ex || !cell || !cell.sourceFile) return
  const effectiveRow = line !== undefined ? line : (cell.sourceRow ?? 0)
  openInEditor({
    root: ex.root,
    exampleDir: ex.dir,
    relPath: cell.sourceFile,
    line: effectiveRow + 1,
  })
}

/** Template helper: true when the inner artefact card can dispatch an open-in-editor handoff. */
function canOpenInnerArtefactInEditor(artId: string): boolean {
  if (!activeExampleRef?.value) return false
  return !!innerArtefactCell(artId)?.sourceFile
}

const workspaceKeyRef = inject<Ref<string>>('tritonWorkspaceKey', ref(''))
const scalaCoverageRef = useScalaCoverageKeyed(workspaceKeyRef, String(props.boxId ?? ''))
const relationTypeVisibilityRef = inject<Ref<Record<string, boolean>>>(
  'tritonRelationTypeVisibility',
  ref({}),
)

/**
 * Real coverage percentage from Scoverage (when available).
 *
 * Important: do not show any placeholder. When no coverage is known for this artefact,
 * we render **no** coverage indicator at all.
 */
const coveragePercent = computed((): number | null => {
  const v = scalaCoverageRef.value?.stmtPct
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  return null
})

const hasCoverage = computed(() => coveragePercent.value !== null)
/** Safe numeric for template bindings (only used when `hasCoverage`). */
const coveragePercentValue = computed(() => coveragePercent.value ?? 0)
const simulatedMetrics = computed(() => simulatedMetricsForBox(props.boxId))

const innerCoverageVersion = ref(0)
const offInnerCoverage = onScalaCoverageChanged(() => {
  innerCoverageVersion.value += 1
})
onScopeDispose(offInnerCoverage)

function innerCoveragePercent(id: string): number | null {
  void innerCoverageVersion.value
  const ws = workspaceKeyRef.value ?? ''
  const v = getScalaCoverage(ws, id)?.stmtPct
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  return null
}

function innerHasCoverage(id: string): boolean {
  return innerCoveragePercent(id) !== null
}

function innerCoveragePercentValue(id: string): number {
  return innerCoveragePercent(id) ?? 0
}

const innerDrillPathArr = computed(() => [...props.innerDrillPath])

const activeInnerSpec = computed((): TritonInnerPackageSpec | null => {
  const path = innerDrillPathArr.value
  if (!path.length) return null
  return findSpecAtPath(props.innerPackages, path)
})

const topLevelInnerPackages = computed((): readonly InnerPackageSummary[] => {
  return Array.isArray(props.innerPackages) ? props.innerPackages : []
})

/**
 * Structural relations as produced by the graph builder, regardless of visibility toggles.
 *
 * Important: relation checkboxes are a rendering concern only. Layout, focus neighbourhoods,
 * and drill context should remain stable when a relation type is hidden, otherwise simply
 * unchecking a box causes nodes to jump around.
 */
const allInnerArtefactRelations = computed((): readonly TritonInnerArtefactRelationSpec[] => {
  return Array.isArray(props.innerArtefactRelations) ? props.innerArtefactRelations : []
})

/** Relations currently visible in the UI after applying the relation-type checkboxes. */
const innerArtefactRelationList = computed((): readonly TritonInnerArtefactRelationSpec[] => {
  const visibility = relationTypeVisibilityRef.value
  return allInnerArtefactRelations.value.filter(
    (rel) => !shouldHideEdgeForRelationFilter({ label: rel.label }, visibility),
  )
})

function innerSimulatedMetrics(id: string) {
  return simulatedMetricsForBox(id)
}

const innerArtefactById = computed(() => {
  const m = new Map<string, InnerArtefactSummary>()
  for (const a of props.innerArtefacts) m.set(a.id, a)
  return m
})

/**
 * When focus is active, the subset of artefact IDs to show: the focused artefact itself,
 * its direct neighbours (1 hop, either direction), and their neighbours (2 hops). All
 * other artefacts are hidden so the diagram stays readable.
 *
 * Cross-package case: when the globally focused artefact lives in another package, this box
 * uses `crossArtefactRelations` to find which of its own artefacts are connected to that
 * foreign artefact, then shows those plus their same-package neighbours (1 hop).
 *
 * Returns `null` when no focus is active (show everything).
 */
const focusFilteredIds = computed((): Set<string> | null => {
  const rels = allInnerArtefactRelations.value
  const localIds = new Set(props.innerArtefacts.map((a) => a.id))

  // --- local focus: the focused artefact is in this package ---
  if (innerArtefactFocusActive.value && props.focusedInnerArtefactId) {
    const focusedId = props.focusedInnerArtefactId
    const direct = new Set<string>([focusedId])
    for (const rel of rels) {
      if (rel.from === focusedId) direct.add(rel.to)
      if (rel.to === focusedId) direct.add(rel.from)
    }
    const visible = new Set(direct)
    for (const rel of rels) {
      if (direct.has(rel.from)) visible.add(rel.to)
      if (direct.has(rel.to)) visible.add(rel.from)
    }
    return visible
  }

  // --- cross-package focus: some other package has a focused artefact ---
  const globalId = props.globalFocusedArtefactId
  if (globalId && !localIds.has(globalId)) {
    // Find local artefacts directly connected to the foreign focused artefact
    const crossRels = props.crossArtefactRelations ?? []
    const locallyConnected = new Set<string>()
    for (const rel of crossRels) {
      if (rel.from === globalId && localIds.has(rel.to)) locallyConnected.add(rel.to)
      if (rel.to === globalId && localIds.has(rel.from)) locallyConnected.add(rel.from)
    }
    if (!locallyConnected.size) return new Set() // hide all artefacts — no cross-connection
    // Expand by 1 hop within this package
    const visible = new Set(locallyConnected)
    for (const rel of rels) {
      if (locallyConnected.has(rel.from)) visible.add(rel.to)
      if (locallyConnected.has(rel.to)) visible.add(rel.from)
    }
    return visible
  }

  return null
})

/**
 * LR columns: abstract parents left → concrete subtypes right (see {@link assignInnerArtefactLayers}).
 *
 * All directional structural relations shape the column layout:
 *   - `extends` / `with`: parent (from) left → child (to) right.
 *   - `gets`: consumer (from) left → dependency (to) right.
 *   - `creates`: creator (from) left → created artefact (to) right.
 *
 * When focus is active only the filtered subset of artefacts and their connecting
 * edges are passed to the layout algorithm.
 */
const innerArtefactLayerColumns = computed((): string[][] => {
  const filter = focusFilteredIds.value
  const allIds = props.innerArtefacts.map((a) => a.id)
  const ids = filter ? allIds.filter((id) => filter.has(id)) : allIds
  if (!ids.length) return []
  const rels = allInnerArtefactRelations.value
  const filteredRels = filter ? rels.filter((r) => filter.has(r.from) && filter.has(r.to)) : rels
  if (!filteredRels.length) return [ids]
  return assignInnerArtefactLayers(ids, filteredRels)
})

const innerEdgeMarkerId = computed(() =>
  `tg-inner-inh-${String(props.boxId).replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
)

type InnerEdgeDraw = {
  id: string
  path: string
  labelX: number
  labelY: number
  /** YAML / graph value (`extends` | `with` | `gets` | `creates`). */
  relationLabel: string
  displayLabel: string
  /**
   * Rendering bucket — drives stroke color, display label, and SVG marker selection. We keep
   * `'with'` and `'extends'` distinct from `'gets'` (instead of collapsing the two inheritance
   * kinds) because the marker definitions are keyed on this value.
   */
  kind: 'extends' | 'with' | 'gets' | 'creates'
  stroke: string
  from: string
  to: string
}

const innerArtefactDiagramRef = ref<HTMLElement | null>(null)
const innerEdgeDraws = ref<InnerEdgeDraw[]>([])
const innerArtefactSlotEls = new Map<string, HTMLElement>()
const innerHoverEdgeId = ref<string | null>(null)
const innerHoverArtId = ref<string | null>(null)

function innerEdgeLabelSvgStyleFor(draw: InnerEdgeDraw): Record<string, string> {
  const s = dependencyEdgeLabelStyle(draw.stroke, innerEdgeEmphasized(draw))
  return {
    fill: String(s.fill ?? draw.stroke),
    fontSize: String(s.fontSize ?? '11px'),
    fontWeight: String(s.fontWeight ?? '500'),
    opacity: String(s.opacity ?? '0.88'),
  }
}

function innerArtefactRelationStroke(label: string): { kind: 'extends' | 'with' | 'gets' | 'creates'; stroke: string } {
  if (label === 'with') return { kind: 'with', stroke: SCALA_HAS_TRAIT_STROKE }
  if (label === 'gets') return { kind: 'gets', stroke: SCALA_GETS_STROKE }
  if (label === 'creates') return { kind: 'creates', stroke: SCALA_CREATES_STROKE }
  return { kind: 'extends', stroke: SCALA_EXTENDS_STROKE }
}

function innerArtefactEdgeDisplayLabel(kind: 'extends' | 'with' | 'gets' | 'creates', wrapperName?: string): string {
  if (kind === 'with') return 'has trait'
  if (kind === 'gets') return wrapperName ? `gets as ${wrapperName}` : 'gets'
  if (kind === 'creates') return 'creates'
  return 'extends'
}

function innerEdgeMarkerSuffix(kind: 'extends' | 'with' | 'gets' | 'creates'): string {
  if (kind === 'with') return 'hastrait'
  if (kind === 'gets') return 'gets'
  if (kind === 'creates') return 'creates'
  return 'extends'
}

const innerArtefactFocusActive = computed(
  () => !!props.focusedInnerArtefactId && !innerDrillPathArr.value.length,
)

/**
 * True when this box is unfocused (no layer drill) but a cross-package focus is active —
 * i.e. another package has a focused artefact that is connected to artefacts in this package.
 * Drives the compact artefact preview shown in the unfocused box.
 */
const crossPackagePreviewActive = computed(() => {
  if (props.focused) return false
  const ids = focusFilteredIds.value
  return ids !== null && ids.size > 0
})

const emphasizedInnerEdgeDraws = computed(() => innerEdgeDraws.value.filter((draw) => innerEdgeEmphasized(draw)))
const normalInnerEdgeDraws = computed(() => innerEdgeDraws.value.filter((draw) => !innerEdgeEmphasized(draw)))


function innerEdgeEmphasized(draw: InnerEdgeDraw): boolean {
  const hid = innerHoverEdgeId.value
  const aid = innerHoverArtId.value
  if (hid) return draw.id === hid
  if (aid) return draw.from === aid || draw.to === aid
  return false
}

function innerArtefactEmphasized(artId: string): boolean {
  if (innerHoverArtId.value === artId) return true
  const hid = innerHoverEdgeId.value
  if (!hid) return false
  const d = innerEdgeDraws.value.find((x) => x.id === hid)
  return !!(d && (d.from === artId || d.to === artId))
}

function onInnerEdgeEnter(draw: InnerEdgeDraw) {
  innerHoverEdgeId.value = draw.id
}

function onInnerEdgeLeave(draw: InnerEdgeDraw) {
  if (innerHoverEdgeId.value === draw.id) innerHoverEdgeId.value = null
}

function onInnerArtefactSlotEnter(artId: string) {
  innerHoverArtId.value = artId
}

function onInnerArtefactSlotLeave(artId: string) {
  if (innerHoverArtId.value === artId) innerHoverArtId.value = null
}

function bindInnerArtefactSlotEl(artId: string, el: unknown) {
  if (el instanceof HTMLElement) innerArtefactSlotEls.set(artId, el)
  else innerArtefactSlotEls.delete(artId)
}

function artefactPackageId(artefactId: string): string {
  const sep = artefactId.indexOf('::')
  return sep >= 0 ? artefactId.slice(0, sep) : ''
}

function artefactSimpleName(artefactId: string): string {
  const sep = artefactId.lastIndexOf(':')
  return sep >= 0 ? artefactId.slice(sep + 1) : artefactId
}

type BridgeRelation = {
  from: string
  to: string
  label: string
  wrapperName?: string
}

type BoundaryStubRelation = {
  externalId: string
  externalLabel: string
  foreignArtefactId: string
  localId: string
  side: 'left' | 'right'
  label: string
  wrapperName?: string
}

/**
 * Cross-package relations whose foreign endpoint lives in one of this package's visible child
 * package boxes. We render them as package-box -> local-artefact bridges in the focused root
 * view so parent-package artefacts like `Mammal` / `Nursing` can show incoming edges from
 * `carnivores` / `herbivores` even though those child packages are not expanded to their
 * individual artefacts yet.
 */
const crossPackageBridgeRelations = computed((): readonly BridgeRelation[] => {
  if (innerDrillPathArr.value.length > 0) return []
  if (!props.focused) return []
  if (!props.innerPackages.length || !props.innerArtefacts.length) return []

  const localArtefactIds = new Set(props.innerArtefacts.map((a) => a.id))
  const childPackageIds = props.innerPackages.map((p) => p.id)
  const mapForeignArtefactToChildPackage = (artefactId: string): string | null => {
    const pkgId = artefactPackageId(artefactId)
    if (!pkgId) return null
    for (const childId of childPackageIds) {
      if (pkgId === childId || pkgId.startsWith(`${childId}.`)) return childId
    }
    return null
  }

  const out: BridgeRelation[] = []
  const seen = new Set<string>()
  for (const rel of props.crossArtefactRelations ?? []) {
    const fromLocal = localArtefactIds.has(rel.from)
    const toLocal = localArtefactIds.has(rel.to)
    if (fromLocal === toLocal) continue
    const localId = fromLocal ? rel.from : rel.to
    const foreignId = fromLocal ? rel.to : rel.from
    const childPackageId = mapForeignArtefactToChildPackage(foreignId)
    if (!childPackageId) continue
    const from = fromLocal ? localId : childPackageId
    const to = fromLocal ? childPackageId : localId
    const key = `${from}\u0001${to}\u0001${rel.label}\u0001${rel.wrapperName ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ from, to, label: rel.label, ...(rel.wrapperName ? { wrapperName: rel.wrapperName } : {}) })
  }
  return out
})

/**
 * Cross-package relations whose far endpoint is NOT visible as an inner child package box.
 * Rendered as boundary stubs in the focused package view so local artefacts can still show
 * incoming/outgoing dependencies from foreign packages.
 */
const crossPackageBoundaryStubRelations = computed((): readonly BoundaryStubRelation[] => {
  if (innerDrillPathArr.value.length > 0) return []
  if (!props.focused) return []
  if (!props.innerArtefacts.length) return []

  const localArtefactIds = new Set(props.innerArtefacts.map((a) => a.id))
  const focusedLocalId = props.focusedInnerArtefactId ?? null
  const childPackageIds = props.innerPackages.map((p) => p.id)
  const foreignIsVisibleChildPackage = (artefactId: string): boolean => {
    const pkgId = artefactPackageId(artefactId)
    if (!pkgId) return false
    return childPackageIds.some((childId) => pkgId === childId || pkgId.startsWith(`${childId}.`))
  }

  const out: BoundaryStubRelation[] = []
  const seen = new Set<string>()
  for (const rel of props.crossArtefactRelations ?? []) {
    const fromLocal = localArtefactIds.has(rel.from)
    const toLocal = localArtefactIds.has(rel.to)
    if (fromLocal === toLocal) continue
    const localId = fromLocal ? rel.from : rel.to
    const foreignId = fromLocal ? rel.to : rel.from
    if (foreignIsVisibleChildPackage(foreignId)) continue
    if (focusedLocalId && localId !== focusedLocalId) continue
    const side: 'left' | 'right' = fromLocal ? 'right' : 'left'
    const foreignPkgId = artefactPackageId(foreignId)
    const externalLabel = focusedLocalId
      ? artefactSimpleName(foreignId)
      : (foreignPkgId.split('.').pop() || foreignPkgId || 'external')
    const externalId = focusedLocalId
      ? `__ext-${side}:art:${foreignId}`
      : `__ext-${side}:pkg:${foreignPkgId || foreignId}`
    const key = `${externalId}\u0001${localId}\u0001${rel.label}\u0001${rel.wrapperName ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      externalId,
      externalLabel,
      foreignArtefactId: foreignId,
      localId,
      side,
      label: rel.label,
      ...(rel.wrapperName ? { wrapperName: rel.wrapperName } : {}),
    })
  }
  return out
})

const crossPackageExternalEndpoints = computed(() => {
  const byId = new Map<string, { id: string; label: string; side: 'left' | 'right' }>()
  for (const rel of crossPackageBoundaryStubRelations.value) {
    if (!byId.has(rel.externalId)) {
      byId.set(rel.externalId, { id: rel.externalId, label: rel.externalLabel, side: rel.side })
    }
  }
  const all = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label))
  return {
    left: all.filter((x) => x.side === 'left'),
    right: all.filter((x) => x.side === 'right'),
  }
})

function refreshInnerArtefactEdges() {
  const root = innerArtefactDiagramRef.value
  const rels = [
    ...crossPackageBridgeRelations.value,
    ...crossPackageBoundaryStubRelations.value.map((rel) => ({
      from: rel.side === 'left' ? rel.externalId : rel.localId,
      to: rel.side === 'left' ? rel.localId : rel.externalId,
      label: rel.label,
      wrapperName: rel.wrapperName,
    })),
    ...innerArtefactRelationList.value,
  ]
  if (!root || !rels.length) {
    innerEdgeDraws.value = []
    return
  }
  const sharedDraws = buildAnchoredSmoothStepRelationDraws({
    rootEl: root,
    relations: rels.map((rel, index) => ({
      id: `ie-${props.boxId}-${index}`,
      from: rel.from,
      to: rel.to,
    })),
    slotEls: innerArtefactSlotEls,
  })
  const out: InnerEdgeDraw[] = []
  for (let i = 0; i < sharedDraws.length; i++) {
    const geom = sharedDraws[i]!
    const rel = rels[i]!
    const { kind, stroke } = innerArtefactRelationStroke(rel.label)
    out.push({
      id: geom.id,
      path: geom.path,
      labelX: geom.labelX,
      labelY: geom.labelY,
      relationLabel: rel.label,
      displayLabel: innerArtefactEdgeDisplayLabel(kind, rel.wrapperName),
      kind,
      stroke,
      from: geom.from,
      to: geom.to,
    })
  }
  innerEdgeDraws.value = out
}

let innerArtefactRo: ResizeObserver | null = null
let innerEdgeRaf = 0

/** Matches flex / gap transitions on `.package-box__inner-artefact-*` so edges use final anchor rects. */
const INNER_EDGE_LAYOUT_SETTLE_MS = 480

let innerEdgeSettleTimer: ReturnType<typeof setTimeout> | null = null

function scheduleInnerEdgeRefresh() {
  if (innerEdgeRaf) return
  innerEdgeRaf = requestAnimationFrame(() => {
    innerEdgeRaf = 0
    refreshInnerArtefactEdges()
  })
}

function scheduleInnerEdgeRefreshSettled() {
  scheduleInnerEdgeRefresh()
  if (innerEdgeSettleTimer != null) {
    clearTimeout(innerEdgeSettleTimer)
    innerEdgeSettleTimer = null
  }
  void nextTick(() => {
    scheduleInnerEdgeRefresh()
    requestAnimationFrame(() => {
      scheduleInnerEdgeRefresh()
      requestAnimationFrame(() => scheduleInnerEdgeRefresh())
    })
  })
  innerEdgeSettleTimer = setTimeout(() => {
    innerEdgeSettleTimer = null
    refreshInnerArtefactEdges()
  }, INNER_EDGE_LAYOUT_SETTLE_MS)
}

/** Inner-diagram panel: child packages and/or Scala artefacts (artefacts only at top-level inner view). */
const hasInnerDiagram = computed(
  () =>
    props.innerPackages.length > 0 || (props.innerArtefacts.length > 0 && !innerDrillPathArr.value.length),
)

function onInnerCardClick(id: string) {
  const p = innerDrillPathArr.value
  if (p.length && p[p.length - 1] === id) {
    emit('update-inner-drill-path', p.slice(0, -1))
    return
  }
  emit('update-inner-drill-path', [...p, id])
}

function clearInnerDrill() {
  emit('update-inner-drill-path', [])
  emit('update-inner-artefact-focus', null)
}

function onArtefactRowClick(id: string) {
  emit('update-inner-artefact-focus', id)
}

/**
 * Per-inner-artefact pin / accent state — single source of truth lives in the parent
 * flow node's `data` (`innerArtefactPinned` / `innerArtefactColors` props), so it
 *
 *   1. Survives across {@link GraphDrillIn} layer-snapshot restores, and
 *   2. Is observable by the drill machinery — which uses the pinned map to refuse
 *      switching the layer drill away from a package whose inner artefact is pinned.
 *
 * This component is a lens over those props: read via the helpers below, write via the
 * `update-inner-artefact-pinned` / `update-inner-artefact-colors` events. Mirrors the
 * round-trip pattern already used for `focusedInnerArtefactId`.
 */
function isInnerArtefactPinned(id: string): boolean {
  return !!props.innerArtefactPinned?.[id]
}

function innerArtefactAccent(id: string): string {
  return props.innerArtefactColors?.[id] ?? boxColorForId(id)
}

function onInnerArtefactTogglePin(id: string, ev: MouseEvent) {
  ev.stopPropagation()
  const cur = props.innerArtefactPinned ?? {}
  const next = { ...cur }
  if (next[id]) delete next[id]
  else next[id] = true
  emit('update-inner-artefact-pinned', next)
}

function onInnerArtefactCycleColor(id: string) {
  const cur = props.innerArtefactColors ?? {}
  const currentColor = cur[id] ?? boxColorForId(id)
  emit('update-inner-artefact-colors', { ...cur, [id]: nextNamedBoxColor(currentColor) })
}

/**
 * Click on focused-artefact chrome (header / padding) → unfocus the artefact only.
 *
 * `stopPropagation` is critical: Vue Flow's `onNodeClick` listens on the entire node DOM
 * subtree, so without stopping here the click would bubble out of `PackageBox` and trigger
 * `applyLayerDrill(packageId)` in `GraphDrillIn.vue`, which would toggle the *outer*
 * package's layer-drill off as well. Tools and the artefact body have their own
 * `@click.stop` for the same reason.
 */
function onFocusedArtefactBackgroundClick(ev: MouseEvent) {
  ev.stopPropagation()
  emit('update-inner-artefact-focus', null)
}

function innerArtefactCell(id: string): InnerArtefactSummary | undefined {
  return innerArtefactById.value.get(id)
}

function innerDrillBackOne() {
  const p = innerDrillPathArr.value
  if (p.length) emit('update-inner-drill-path', p.slice(0, -1))
}

const rootEl = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
/** Title too wide for one line or title+subtitle overflow → vertical title; subtitle only when horizontal. */
const tightLayout = ref(false)
/** Short, wide unfocused box: folder icon left, title + subtitle to the right (no stacked column). */
const wideShortRow = ref(false)

let measureCanvas: CanvasRenderingContext2D | null = null

function measureTitleWidth(label: string, title: HTMLElement): number {
  if (!measureCanvas) {
    measureCanvas = title.ownerDocument.createElement('canvas').getContext('2d')
  }
  const ctx = measureCanvas
  if (!ctx) return 0
  const cs = getComputedStyle(title)
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  return ctx.measureText(label).width
}

/** Hysteresis so `tightLayout` / `wideShortRow` do not flip every ResizeObserver tick (layout ↔ measure feedback). */
const TITLE_TIGHT_ENTER = 4
const TITLE_TIGHT_EXIT = 14
const WIDE_SHORT_MAX_H = 148
const WIDE_SHORT_MIN_H_EXIT = 162
const WIDE_SHORT_MIN_AR = 1.85
const WIDE_SHORT_EXIT_AR = 1.72

function measure() {
  if (props.embedded) {
    tightLayout.value = false
    wideShortRow.value = false
    return
  }
  if (props.focused) {
    tightLayout.value = false
    wideShortRow.value = false
    return
  }
  const root = rootEl.value
  const title = titleEl.value
  if (!root || !title) return
  /** Top-level Scala declaration leaves: match package vertical card — never use wide-shallow row mode. */
  if (props.leafVisual === 'artefact') {
    wideShortRow.value = false
    const label = String(props.label ?? '')
    const padX =
      parseFloat(getComputedStyle(root).paddingLeft) + parseFloat(getComputedStyle(root).paddingRight)
    const availW = Math.max(0, root.clientWidth - padX - 14)
    const tw = measureTitleWidth(label, title)
    const titleDemandsTight = tightLayout.value ? tw > availW - TITLE_TIGHT_EXIT : tw > availW + TITLE_TIGHT_ENTER
    tightLayout.value = titleDemandsTight
    return
  }
  const w = root.clientWidth
  const h = root.clientHeight
  const aspect = w / Math.max(1, h)
  /** Low, wide chrome typical of LR-layout package nodes — prefer icon | text row over tall centered icon. */
  if (wideShortRow.value) {
    wideShortRow.value = h <= WIDE_SHORT_MIN_H_EXIT && aspect >= WIDE_SHORT_EXIT_AR
  } else {
    wideShortRow.value = h <= WIDE_SHORT_MAX_H && aspect >= WIDE_SHORT_MIN_AR
  }
  if (wideShortRow.value) {
    tightLayout.value = false
    return
  }
  const label = String(props.label ?? '')
  const padX =
    parseFloat(getComputedStyle(root).paddingLeft) + parseFloat(getComputedStyle(root).paddingRight)
  const availW = Math.max(0, root.clientWidth - padX - 14)
  const tw = measureTitleWidth(label, title)
  /** Enter tight only on clear overflow; exit only when horizontal title clearly fits (avoids flip-flop at ±1px). */
  const titleDemandsTight = tightLayout.value ? tw > availW - TITLE_TIGHT_EXIT : tw > availW + TITLE_TIGHT_ENTER
  /** Only title width drives vertical writing mode — scroll-based overflow fought `v-if` on subtitle and flickered. */
  tightLayout.value = titleDemandsTight
}

let ro: ResizeObserver | null = null
let measureRaf = 0

function scheduleMeasure() {
  if (measureRaf) return
  measureRaf = requestAnimationFrame(() => {
    measureRaf = 0
    measure()
  })
}

onMounted(() => {
  void nextTick(() => {
    measure()
    ro = new ResizeObserver(() => scheduleMeasure())
    if (rootEl.value) ro.observe(rootEl.value)
  })
})

onUnmounted(() => {
  if (measureRaf) {
    cancelAnimationFrame(measureRaf)
    measureRaf = 0
  }
  ro?.disconnect()
  ro = null
  innerArtefactRo?.disconnect()
  innerArtefactRo = null
  if (innerEdgeRaf) {
    cancelAnimationFrame(innerEdgeRaf)
    innerEdgeRaf = 0
  }
  if (innerEdgeSettleTimer != null) {
    clearTimeout(innerEdgeSettleTimer)
    innerEdgeSettleTimer = null
  }
  innerHoverEdgeId.value = null
  innerHoverArtId.value = null
})

watch(
  () => [
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
  ],
  () => void nextTick(measure),
)

watch(innerArtefactDiagramRef, (el) => {
  innerArtefactRo?.disconnect()
  innerArtefactRo = null
  if (el) {
    innerArtefactRo = new ResizeObserver(() => scheduleInnerEdgeRefresh())
    innerArtefactRo.observe(el)
  }
})

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

const editing = ref(false)
const draftLabel = ref('')
const draftDescription = ref('')
const labelInput = ref<HTMLInputElement | null>(null)

/** Header dblclick on a Scala-leaf renders read-only chrome — no rename/description modal. */
function onHeaderDblClick() {
  if (props.leafVisual === 'artefact') return
  startEditing()
}

function startEditing() {
  if (props.embedded) return
  if (props.leafVisual === 'artefact') return
  if (editing.value) return
  draftLabel.value = String(props.label ?? '')
  draftDescription.value = String(props.description ?? '')
  editing.value = true
  void nextTick(() => {
    const el = labelInput.value
    if (el) {
      el.focus()
      el.select()
    }
  })
}

function commitEdit() {
  if (!editing.value) return
  const newLabel = draftLabel.value.trim()
  if (newLabel && newLabel !== String(props.label ?? '')) {
    emit('rename', newLabel)
  }
  const newDesc = draftDescription.value
  if (newDesc !== String(props.description ?? '')) {
    emit('description-change', newDesc)
  }
  editing.value = false
}

function cancelEdit() {
  editing.value = false
}

function onLabelKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Enter') {
    ev.preventDefault()
    commitEdit()
  } else if (ev.key === 'Escape') {
    ev.preventDefault()
    cancelEdit()
  }
}

function onDescriptionKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    cancelEdit()
  }
}
</script>

<template>
  <!-- Stacked inner card: same visual language as the default (unfocused) top-level box, scaled down. -->
  <div
    v-if="embedded"
    ref="rootEl"
    class="package-box package-box--embedded"
    :class="{ 'package-box--pinned': pinned, 'package-box--has-metrics': true }"
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
    <div class="lang-icon-slot lang-icon-slot--embedded">
      <img class="lang-svg folder-icon" :src="folderIconUrl" alt="" aria-hidden="true" decoding="async" />
    </div>
    <div class="package-box__body package-box__body--embedded">
      <div ref="titleEl" class="title">{{ label }}</div>
      <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
    </div>
  </div>

  <!--
    Layer-drill focused root: shared box chrome (accent strip, focus outline, padding,
    tools cluster, tight layout, transitions) for both Scala packages and Scala artefact leaves.
    Artefact-specific content is injected via slots so {@link ScalaArtefactBox} can reuse this shell
    without duplicating chrome — see `focused-tools-prefix`, `focused-header-icon`, `focused-body`.
  -->
  <div v-else-if="focused" class="package-box-host">
    <GeneralFocusedBox
      :accent="accent"
      :title="label"
      :subtitle="declaration || subtitle"
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
          <img class="lang-svg folder-icon" :src="folderIconUrl" alt="" aria-hidden="true" decoding="async" />
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
      <template v-else>{{ declaration || subtitle }}</template>
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

        <template v-if="!innerDrillPathArr.length">
          <div
            v-if="innerArtefactLayerColumns.length || topLevelInnerPackages.length"
            ref="innerArtefactDiagramRef"
            class="package-box__inner-artefact-diagram"
            :class="{ 'package-box__inner-artefact-diagram--artefact-focus': innerArtefactFocusActive }"
          >
            <!--
              Base edge SVG comes first in DOM so it paints below the artefact cols.
              Both the SVG and cols are at z-index: 0, so DOM order determines stacking.
              The overlay SVG (z-index: 2) still renders above cols via explicit z-index.
            -->
            <svg
              v-if="innerEdgeDraws.length"
              class="package-box__inner-artefact-edges"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <marker
                  :id="`${innerEdgeMarkerId}-extends`"
                  class="package-box__inner-edge-marker"
                  markerWidth="14"
                  markerHeight="14"
                  refX="12"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--extends" />
                </marker>
                <marker
                  :id="`${innerEdgeMarkerId}-hastrait`"
                  class="package-box__inner-edge-marker"
                  markerWidth="14"
                  markerHeight="14"
                  refX="12"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--hastrait" />
                </marker>
                <marker
                  :id="`${innerEdgeMarkerId}-gets`"
                  class="package-box__inner-edge-marker"
                  markerWidth="14"
                  markerHeight="14"
                  refX="12"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--gets" />
                </marker>
                <marker
                  :id="`${innerEdgeMarkerId}-creates`"
                  class="package-box__inner-edge-marker"
                  markerWidth="14"
                  markerHeight="14"
                  refX="12"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--creates" />
                </marker>
              </defs>
              <g v-for="e in normalInnerEdgeDraws" :key="e.id" class="package-box__inner-edge-group">
                <path
                  :d="e.path"
                  class="package-box__inner-edge-hit"
                  fill="none"
                  @mouseenter="onInnerEdgeEnter(e)"
                  @mouseleave="onInnerEdgeLeave(e)"
                />
                <path
                  :d="e.path"
                  :class="[
                    'package-box__inner-edge-path',
                    { 'package-box__inner-edge-path--emph': innerEdgeEmphasized(e) },
                    e.kind === 'gets' ? 'package-box__inner-edge-path--gets' : null,
                    e.kind === 'creates' ? 'package-box__inner-edge-path--creates' : null,
                  ]"
                  fill="none"
                  :style="{ stroke: e.stroke }"
                  :marker-end="`url(#${innerEdgeMarkerId}-${innerEdgeMarkerSuffix(e.kind)})`"
                />
                <text
                  :x="e.labelX"
                  :y="e.labelY - 15"
                  class="package-box__inner-edge-label"
                  :class="{ 'package-box__inner-edge-label--emph': innerEdgeEmphasized(e) }"
                  :style="innerEdgeLabelSvgStyleFor(e)"
                  text-anchor="middle"
                  dominant-baseline="middle"
                >
                  {{ e.displayLabel }}
                </text>
              </g>
            </svg>
            <!--
              Focus inside an inheritance column: the focused column stretches to the full
              sub-diagram height and replaces its rows with a single ScalaArtefactBox card.
              Sibling artefacts in the same column are hidden (`v-if` skip) so the focus card
              gets all the column space, but artefacts in **other** inheritance layers stay
              fully visible — the user still sees the parent traits / classes (left columns)
              and subclasses (right columns). Inheritance edges keep drawing throughout.
            -->
            <div
              class="package-box__inner-artefact-cols"
              :class="{
                'package-box__inner-artefact-cols--artefact-focus': innerArtefactFocusActive,
                'package-box__inner-artefact-cols--with-packages': topLevelInnerPackages.length > 0,
              }"
            >
              <div
                v-if="topLevelInnerPackages.length"
                class="package-box__inner-package-stack"
              >
                <div
                  v-for="child in topLevelInnerPackages"
                  :key="child.id"
                  :ref="(el) => bindInnerArtefactSlotEl(child.id, el)"
                  class="package-box__inner-slot package-box__inner-slot--clickable package-box__inner-slot--inner-package"
                  @click.stop="onInnerCardClick(child.id)"
                >
                  <PackageBox
                    embedded
                    :box-id="child.id"
                    :label="child.name"
                    :subtitle="child.subtitle ?? ''"
                    :focused="false"
                    :pinned="false"
                    :show-pin-tool="false"
                    :show-color-tool="false"
                  />
                </div>
              </div>
              <div
                v-if="crossPackageExternalEndpoints.left.length"
                class="package-box__external-endpoints package-box__external-endpoints--left"
              >
                <div
                  v-for="ep in crossPackageExternalEndpoints.left"
                  :key="ep.id"
                  :ref="(el) => bindInnerArtefactSlotEl(ep.id, el)"
                  class="package-box__external-endpoint"
                >
                  <span class="package-box__artefact-anchor package-box__artefact-anchor--out" aria-hidden="true" />
                  <div class="package-box__external-endpoint-chip">{{ ep.label }}</div>
                </div>
              </div>
              <div
                v-for="(col, ci) in innerArtefactLayerColumns"
                :key="'col-' + ci"
                class="package-box__inner-artefact-col"
                :class="{
                  'package-box__inner-artefact-col--focus':
                    innerArtefactFocusActive && col.includes(props.focusedInnerArtefactId ?? ''),
                  'package-box__inner-artefact-col--peer':
                    innerArtefactFocusActive && !col.includes(props.focusedInnerArtefactId ?? ''),
                }"
              >
                <template v-for="artId in col" :key="artId">
                  <!-- Focused row → swap for full-height ScalaArtefactBox card. -->
                  <div
                    v-if="innerArtefactFocusActive && focusedInnerArtefactId === artId && innerArtefactCell(artId)"
                    :ref="(el) => bindInnerArtefactSlotEl(artId, el)"
                    class="package-box__inner-slot package-box__inner-slot--artefact-layer package-box__inner-slot--artefact-focused-cell"
                    :style="{ '--box-accent': innerArtefactAccent(artId) }"
                    @click="onFocusedArtefactBackgroundClick"
                  >
                    <span
                      class="package-box__artefact-anchor package-box__artefact-anchor--in"
                      :class="{ 'package-box__artefact-anchor--emph': innerArtefactEmphasized(artId) }"
                      aria-hidden="true"
                    />
                    <span
                      class="package-box__artefact-anchor package-box__artefact-anchor--out"
                      :class="{ 'package-box__artefact-anchor--emph': innerArtefactEmphasized(artId) }"
                      aria-hidden="true"
                    />
                    <ScalaArtefactBox
                      :box-id="artId"
                      :label="innerArtefactCell(artId)!.name"
                      :subtitle="innerArtefactCell(artId)!.subtitle ?? ''"
                      :declaration="innerArtefactCell(artId)!.declaration"
                      :constructor-params="innerArtefactCell(artId)!.constructorParams"
                      :method-signatures="innerArtefactCell(artId)!.methodSignatures"
                      :notes="notes"
                      :box-color="innerArtefactAccent(artId)"
                      :pinned="isInnerArtefactPinned(artId)"
                      :show-pin-tool="true"
                      :show-color-tool="true"
                      :can-open-in-editor="canOpenInnerArtefactInEditor(artId)"
                      class="package-box__inner-artefact-focus-card"
                      @toggle-pin="(ev: MouseEvent) => onInnerArtefactTogglePin(artId, ev)"
                      @cycle-color="onInnerArtefactCycleColor(artId)"
                      @open-in-editor="(line?: number) => openInnerArtefactInEditor(artId, line)"
                    />
                  </div>
                  <!--
                    Sibling artefact in the focused column → hidden so the focus card claims
                    the column. We render an empty placeholder (no element) so layout stays
                    clean and the slot ref map drops the entry naturally.
                  -->
                  <template
                    v-else-if="
                      innerArtefactFocusActive
                        && col.includes(props.focusedInnerArtefactId ?? '')
                        && focusedInnerArtefactId !== artId
                    "
                  />
                  <!-- All other artefacts (including other inheritance layers) → normal row. -->
                  <div
                    v-else-if="innerArtefactCell(artId)"
                    :ref="(el) => bindInnerArtefactSlotEl(artId, el)"
                    class="package-box__inner-slot package-box__inner-slot--artefact package-box__inner-slot--clickable package-box__inner-slot--artefact-layer"
                    :class="{
                      'package-box__inner-slot--inner-hovered': innerArtefactEmphasized(artId),
                    }"
                    :style="{ '--box-accent': innerArtefactAccent(artId) }"
                    @mouseenter="onInnerArtefactSlotEnter(artId)"
                    @mouseleave="onInnerArtefactSlotLeave(artId)"
                    @click.stop="onArtefactRowClick(artId)"
                  >
                    <div class="package-box__artefact-row package-box__artefact-row--has-metrics">
                      <div class="package-box__artefact-metrics">
                        <BoxMetricStrip
                          :coverage-percent="innerHasCoverage(artId) ? innerCoveragePercentValue(artId) : null"
                          :technical-debt-percent="innerSimulatedMetrics(artId).technicalDebtPercent"
                          :issue-count="innerSimulatedMetrics(artId).issueCount"
                          :issue-level="innerSimulatedMetrics(artId).issueLevel"
                        />
                      </div>
                      <span
                        class="package-box__artefact-anchor package-box__artefact-anchor--in"
                        :class="{ 'package-box__artefact-anchor--emph': innerArtefactEmphasized(artId) }"
                        aria-hidden="true"
                      />
                      <span
                        class="package-box__artefact-anchor package-box__artefact-anchor--out"
                        :class="{ 'package-box__artefact-anchor--emph': innerArtefactEmphasized(artId) }"
                        aria-hidden="true"
                      />
                      <div class="lang-icon-slot lang-icon-slot--artefact">
                        <img
                          class="lang-svg"
                          :src="scalaIconForKind(innerArtefactCell(artId)!.subtitle)"
                          :alt="innerArtefactCell(artId)!.subtitle ?? ''"
                          aria-hidden="true"
                          decoding="async"
                        />
                      </div>
                      <div class="package-box__artefact-text">
                        <div class="package-box__artefact-title">{{ innerArtefactCell(artId)!.name }}</div>
                        <div v-if="innerArtefactCell(artId)!.subtitle" class="package-box__artefact-subtitle">
                          {{ innerArtefactCell(artId)!.subtitle }}
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
              <div
                v-if="crossPackageExternalEndpoints.right.length"
                class="package-box__external-endpoints package-box__external-endpoints--right"
              >
                <div
                  v-for="ep in crossPackageExternalEndpoints.right"
                  :key="ep.id"
                  :ref="(el) => bindInnerArtefactSlotEl(ep.id, el)"
                  class="package-box__external-endpoint package-box__external-endpoint--right"
                >
                  <div class="package-box__external-endpoint-chip">{{ ep.label }}</div>
                  <span class="package-box__artefact-anchor package-box__artefact-anchor--in" aria-hidden="true" />
                </div>
              </div>
            </div>
            <svg class="package-box__inner-artefact-edges package-box__inner-artefact-edges--overlay" aria-hidden="true">
              <defs>
                <marker
                  :id="`${innerEdgeMarkerId}-overlay-extends`"
                  class="package-box__inner-edge-marker"
                  markerWidth="14"
                  markerHeight="14"
                  refX="12"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--extends" />
                </marker>
                <marker
                  :id="`${innerEdgeMarkerId}-overlay-hastrait`"
                  class="package-box__inner-edge-marker"
                  markerWidth="14"
                  markerHeight="14"
                  refX="12"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--hastrait" />
                </marker>
                <marker
                  :id="`${innerEdgeMarkerId}-overlay-gets`"
                  class="package-box__inner-edge-marker"
                  markerWidth="14"
                  markerHeight="14"
                  refX="12"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--gets" />
                </marker>
                <marker
                  :id="`${innerEdgeMarkerId}-overlay-creates`"
                  class="package-box__inner-edge-marker"
                  markerWidth="14"
                  markerHeight="14"
                  refX="12"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--creates" />
                </marker>
              </defs>
              <g v-for="e in emphasizedInnerEdgeDraws" :key="e.id" class="package-box__inner-edge-group">
                <path
                  :d="e.path"
                  class="package-box__inner-edge-hit"
                  fill="none"
                  @mouseenter="onInnerEdgeEnter(e)"
                  @mouseleave="onInnerEdgeLeave(e)"
                />
                <path
                  :d="e.path"
                  :class="[
                    'package-box__inner-edge-path',
                    { 'package-box__inner-edge-path--emph': innerEdgeEmphasized(e) },
                    e.kind === 'gets' ? 'package-box__inner-edge-path--gets' : null,
                    e.kind === 'creates' ? 'package-box__inner-edge-path--creates' : null,
                  ]"
                  fill="none"
                  :style="{ stroke: e.stroke }"
                  :marker-end="`url(#${innerEdgeMarkerId}-overlay-${innerEdgeMarkerSuffix(e.kind)})`"
                />
                <text
                  :x="e.labelX"
                  :y="e.labelY - 15"
                  class="package-box__inner-edge-label"
                  :class="{ 'package-box__inner-edge-label--emph': innerEdgeEmphasized(e) }"
                  :style="innerEdgeLabelSvgStyleFor(e)"
                  text-anchor="middle"
                  dominant-baseline="middle"
                >
                  {{ e.displayLabel }}
                </text>
              </g>
            </svg>
          </div>
        </template>

        <template v-else-if="activeInnerSpec">
          <div
            class="package-box__inner-slot package-box__inner-slot--solo package-box__inner-slot--clickable"
            @click.stop="onInnerCardClick(activeInnerSpec.id)"
          >
            <PackageBox
              embedded
              :box-id="activeInnerSpec.id"
              :label="activeInnerSpec.name"
              :subtitle="activeInnerSpec.subtitle ?? ''"
              :focused="false"
              :pinned="false"
              :show-pin-tool="false"
              :show-color-tool="false"
            />
          </div>
          <div
            v-for="child in activeInnerSpec.innerPackages ?? []"
            :key="child.id"
            class="package-box__inner-slot package-box__inner-slot--clickable"
            @click.stop="onInnerCardClick(child.id)"
          >
            <PackageBox
              embedded
              :box-id="child.id"
              :label="child.name"
              :subtitle="child.subtitle ?? ''"
              :focused="false"
              :pinned="false"
              :show-pin-tool="false"
              :show-color-tool="false"
            />
          </div>
        </template>

        <div v-else class="package-box__inner-drill-fallback">
          <span class="inner-drill-fallback-text">Inner path no longer matches this tree.</span>
          <button type="button" class="inner-drill-btn" @click.stop="clearInnerDrill">All packages</button>
        </div>
      </div>

        <div v-else class="package-box__focused-legacy">
          <BoxCompartments :compartments="focusedLegacyCompartments" variant="dense" />
        </div>
      </slot>
    </GeneralFocusedBox>

    <div
      v-if="editing"
      class="package-box__editor nodrag nopan"
      role="dialog"
      aria-label="Edit package"
      @pointerdown.stop
      @mousedown.stop
      @click.stop
      @dblclick.stop
      @keydown.stop
    >
      <label class="editor-field">
        <span class="editor-label">Name</span>
        <input
          ref="labelInput"
          v-model="draftLabel"
          class="title-input"
          spellcheck="false"
          @keydown="onLabelKeydown"
        />
      </label>
      <label class="editor-field">
        <span class="editor-label">Description / AI prompt purpose</span>
        <textarea
          v-model="draftDescription"
          class="description-input"
          rows="5"
          spellcheck="false"
          placeholder="Describe what this package contains (included in the generated AI prompt)…"
          @keydown="onDescriptionKeydown"
        />
      </label>
      <div class="editor-actions">
        <span class="edit-hint">Enter in name to save · Esc to cancel</span>
        <button type="button" class="editor-btn" @click="cancelEdit">Cancel</button>
        <button type="button" class="editor-btn editor-btn--primary" @click="commitEdit">Save</button>
      </div>
    </div>
  </div>

  <!-- Default (unfocused top-level): centered folder icon + title block. -->
  <div
    v-else
    ref="rootEl"
    class="package-box"
    :class="{
      'package-box--wide-short-row': wideShortRow,
      'package-box--tight': tightLayout,
      'package-box--scala-leaf': isScalaLeaf,
      'package-box--pinned': pinned,
      'package-box--tools-wide': showColorTool,
      'package-box--pin-only': showPinTool && !showColorTool,
      'package-box--editing': editing,
      'package-box--has-metrics': true,
      'package-box--cross-preview': crossPackagePreviewActive,
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
    <div
      class="package-box__tools"
      @pointerdown.stop
    >
      <button
        v-if="showPinTool"
        type="button"
        class="tool-btn tool-btn--pin"
        :class="{ 'tool-btn--active': pinned }"
        :title="isScalaLeaf ? 'Pin — keep this declaration highlighted when another box is zoomed' : 'Pin — keep this package highlighted when another box is zoomed'"
        :aria-pressed="pinned ? 'true' : 'false'"
        :aria-label="
          isScalaLeaf
            ? 'Pin declaration (stays highlighted when zooming elsewhere)'
            : 'Pin package (stays focused when zooming elsewhere)'
        "
        @click.stop="emit('toggle-pin', $event)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" class="tool-btn__icon tool-btn__icon--pin">
          <path
            fill="currentColor"
            d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"
          />
        </svg>
      </button>
      <button
        v-if="showColorTool"
        type="button"
        class="tool-btn tool-btn--color"
        :title="`Accent: ${accent}. Click for next color.`"
        aria-label="Change box accent color"
        @click.stop="emit('cycle-color')"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" class="tool-btn__icon tool-btn__icon--color">
          <circle cx="6" cy="8" r="4.25" />
          <circle cx="11" cy="8" r="3" opacity="0.45" />
        </svg>
      </button>
    </div>

    <div class="lang-icon-slot" :class="{ 'lang-icon-slot--scala-leaf': isScalaLeaf }">
      <img
        class="lang-svg"
        :class="isScalaLeaf ? 'scala-leaf-icon' : 'folder-icon'"
        :src="isScalaLeaf ? scalaIconForKind(subtitle) : folderIconUrl"
        :alt="isScalaLeaf ? (subtitle ?? '') : ''"
        aria-hidden="true"
        decoding="async"
      />
    </div>

    <div class="package-box__body" @dblclick.stop="startEditing">
      <div
        ref="titleEl"
        class="title"
        :title="isScalaLeaf ? String(label ?? '') : 'Double-click to rename / edit description'"
      >
        {{ label }}
      </div>
      <div v-if="subtitle && !tightLayout" class="subtitle">{{ subtitle }}</div>
      <div
        v-if="!isScalaLeaf && description && !tightLayout && !wideShortRow"
        class="description-preview"
        :title="description"
      >
        {{ description }}
      </div>
    </div>

    <!-- Cross-package focus preview: compact artefact rows when a connected artefact elsewhere is focused -->
    <div
      v-if="crossPackagePreviewActive && innerArtefactLayerColumns.length"
      ref="innerArtefactDiagramRef"
      class="package-box__inner-artefact-diagram package-box__inner-artefact-diagram--cross-preview nodrag nopan"
      @pointerdown.stop
      @wheel.stop
    >
      <!-- SVG first so DOM order places it below the cols (both at z-index: 0). -->
      <svg
        v-if="innerEdgeDraws.length"
        class="package-box__inner-artefact-edges"
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker :id="`${innerEdgeMarkerId}-xp-extends`" markerWidth="14" markerHeight="14" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--extends" />
          </marker>
          <marker :id="`${innerEdgeMarkerId}-xp-hastrait`" markerWidth="14" markerHeight="14" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--hastrait" />
          </marker>
          <marker :id="`${innerEdgeMarkerId}-xp-gets`" markerWidth="14" markerHeight="14" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--gets" />
          </marker>
          <marker :id="`${innerEdgeMarkerId}-xp-creates`" markerWidth="14" markerHeight="14" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--creates" />
          </marker>
        </defs>
        <g v-for="e in innerEdgeDraws" :key="e.id">
          <path
            :d="e.path"
            class="package-box__inner-edge-path"
            fill="none"
            :style="{ stroke: e.stroke }"
            :marker-end="`url(#${innerEdgeMarkerId}-xp-${innerEdgeMarkerSuffix(e.kind)})`"
          />
          <text
            :x="e.labelX"
            :y="e.labelY - 15"
            class="package-box__inner-edge-label"
            :style="innerEdgeLabelSvgStyleFor(e)"
            text-anchor="middle"
            dominant-baseline="middle"
          >{{ e.displayLabel }}</text>
        </g>
      </svg>
      <div class="package-box__inner-artefact-cols">
        <div
          v-for="(col, ci) in innerArtefactLayerColumns"
          :key="'col-' + ci"
          class="package-box__inner-artefact-col"
        >
          <template v-for="artId in col" :key="artId">
            <div
              v-if="innerArtefactCell(artId)"
              :ref="(el) => bindInnerArtefactSlotEl(artId, el)"
              class="package-box__inner-slot package-box__inner-slot--artefact package-box__inner-slot--artefact-layer"
              :style="{ '--box-accent': innerArtefactAccent(artId) }"
            >
              <div class="package-box__artefact-row">
                <span
                  class="package-box__artefact-anchor package-box__artefact-anchor--in"
                  aria-hidden="true"
                />
                <span
                  class="package-box__artefact-anchor package-box__artefact-anchor--out"
                  aria-hidden="true"
                />
                <div class="lang-icon-slot lang-icon-slot--artefact">
                  <img
                    class="lang-svg"
                    :src="scalaIconForKind(innerArtefactCell(artId)!.subtitle)"
                    :alt="innerArtefactCell(artId)!.subtitle ?? ''"
                    aria-hidden="true"
                    decoding="async"
                  />
                </div>
                <div class="package-box__artefact-text">
                  <div class="package-box__artefact-title">{{ innerArtefactCell(artId)!.name }}</div>
                  <div v-if="innerArtefactCell(artId)!.subtitle" class="package-box__artefact-subtitle">
                    {{ innerArtefactCell(artId)!.subtitle }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div
      v-if="editing"
      class="package-box__editor nodrag nopan"
      role="dialog"
      :aria-label="isScalaLeaf ? 'Edit box' : 'Edit package'"
      @pointerdown.stop
      @mousedown.stop
      @click.stop
      @dblclick.stop
      @keydown.stop
    >
      <label class="editor-field">
        <span class="editor-label">Name</span>
        <input
          ref="labelInput"
          v-model="draftLabel"
          class="title-input"
          spellcheck="false"
          @keydown="onLabelKeydown"
        />
      </label>
      <label class="editor-field">
        <span class="editor-label">Description / AI prompt purpose</span>
        <textarea
          v-model="draftDescription"
          class="description-input"
          rows="5"
          spellcheck="false"
          placeholder="Describe what this package contains (included in the generated AI prompt)…"
          @keydown="onDescriptionKeydown"
        />
      </label>
      <div class="editor-actions">
        <span class="edit-hint">Enter in name to save · Esc to cancel</span>
        <button type="button" class="editor-btn" @click="cancelEdit">Cancel</button>
        <button type="button" class="editor-btn editor-btn--primary" @click="commitEdit">Save</button>
      </div>
    </div>
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
   * routed *under* a box (see `.package-box__inner-artefact-edges` z-index: 0 below, plus
   * Vue Flow rendering edges below nodes by default) stay faintly visible through it.
   */
  --box-fill: color-mix(in srgb, var(--box-accent) 8%, #ffffff);
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
  padding: clamp(6px, 1.2vmin, 14px) clamp(6px, 1.35vmin, 14px);
  padding-right: clamp(6px, 1.35vmin, 14px);
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
 * Cross-package focus preview: the unfocused box grows to show connected artefacts.
 * `height: auto` overrides the normal `height: 100%` so the node expands with content;
 * `overflow: visible` lets the inner diagram spill out if the Vue Flow node allocation
 * hasn't caught up yet.
 */
.package-box--cross-preview {
  height: auto;
  overflow: visible;
}
.package-box__inner-artefact-diagram--cross-preview {
  margin-top: 8px;
  flex: 0 0 auto;
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
 * Coverage bar in the top-right tools cluster. The cluster is `position: absolute`, so the
 * box's content (title / icon) needs reserved padding-right or it slides under the bar.
 * Each modifier below combines with `--has-coverage` for the multi-tool cases — pin / color
 * buttons may wrap to a row below the bar, so the right-pad only needs to clear the widest
 * single-row item, not the cluster's total height.
 */
.package-box--has-metrics {
  padding-right: clamp(46px, 8cqw, 56px);
  padding-top: clamp(20px, 4vmin, 26px);
}
.package-box--has-metrics.package-box--pin-only {
  padding-right: clamp(46px, 8cqw, 56px);
}
.package-box--has-metrics.package-box--tools-wide {
  padding-right: clamp(72px, 12cqw, 108px);
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
  padding-top: clamp(38px, 8vmin, 54px);
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

.package-box__metrics {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  width: min(124px, calc(100% - 12px));
}

.package-box__metrics--embedded {
  top: 4px;
  right: 4px;
}

.lang-icon-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: center;
  flex-shrink: 0;
  width: 100%;
  height: clamp(40px, min(30cqw, 28cqh), 160px);
  min-height: 36px;
  margin-bottom: clamp(6px, 1.5cqh, 16px);
  transform: none;
  pointer-events: none;
}
.package-box--has-metrics .package-box__tools {
  top: 22px;
}
@container (max-width: 150px) {
  .package-box--has-metrics .package-box__tools {
    top: 42px;
  }
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

/** Unfocused: wide + shallow node — icon column left, title/subtitle stack right (LR layout). */
.package-box--wide-short-row {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  padding-top: clamp(4px, 1vmin, 10px);
  padding-bottom: clamp(4px, 1vmin, 10px);
}
.package-box--wide-short-row .lang-icon-slot {
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  align-self: center;
  height: clamp(28px, min(18cqh, 72px), 64px);
  max-height: min(100%, 72px);
  margin-bottom: 0;
  margin-right: clamp(8px, 2.2cqw, 14px);
  justify-content: center;
}
.package-box--wide-short-row .lang-icon-slot :deep(.lang-svg) {
  max-height: min(100%, 52px);
  height: auto;
  width: auto;
}
.package-box--wide-short-row .package-box__body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  align-items: flex-start;
  justify-content: center;
  text-align: left;
}
.package-box--wide-short-row .title {
  text-align: left;
  align-self: stretch;
}
.package-box--wide-short-row .subtitle {
  text-align: left;
  align-self: stretch;
  max-height: 2.8em;
}

.package-box__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
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
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: auto;
}
.package-box--focused-layout .package-box__inner-diagram {
  padding-bottom: 0;
}
.package-box__inner-artefact-diagram {
  position: relative;
  flex: 1 1 auto;
  min-height: min-content;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  transition:
    flex 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    min-height 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
/** When an inner artefact is focused, the diagram band claims the full vertical sub-diagram space. */
.package-box__inner-artefact-diagram--artefact-focus {
  flex: 1 1 0;
  min-height: 0;
}
/**
 * Focused inner artefact card — fills the focused column's full height and width, with the same
 * focus chrome (accent strip, outline, tools cluster) as a focused PackageBox. Cursor stays
 * `default` because clicks on the card chrome unfocus (handled by the wrapper cell below); only
 * the explicit tool buttons / details body are interactive.
 */
.package-box__inner-artefact-focus-card {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  align-self: stretch;
}
/**
 * NOTE: the matching `.package-box__inner-slot--artefact-focused-cell` rule lives lower
 * in the file (after `.package-box__inner-slot--artefact-layer`) so it wins source-order
 * cascade over the `flex: 0 0 auto` collapse rule on equal specificity.
 */
.package-box__inner-artefact-edges {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  /**
   * Base edge SVG is placed *before* the cols in the DOM template so that with both at
   * z-index: 0, DOM paint order makes the SVG render below the cols. This matches the
   * "edges under artefact rows" feel without relying on a z-index difference that could
   * interact badly with intermediate stacking contexts (container-type: size, overflow: auto).
   */
  z-index: 0;
  overflow: visible;
}
.package-box__inner-artefact-edges--overlay {
  z-index: 1;
}
.package-box__inner-edge-hit {
  stroke: transparent;
  stroke-width: 18;
  pointer-events: stroke;
  cursor: default;
}
.package-box__inner-edge-path {
  stroke: var(--box-accent, #64748b);
  stroke-width: 1.35;
  opacity: 0.72;
  vector-effect: non-scaling-stroke;
  stroke-linecap: butt;
  stroke-linejoin: miter;
  pointer-events: none;
  transition:
    stroke-width 0.15s ease,
    opacity 0.15s ease;
}
.package-box__inner-edge-path--emph {
  stroke-width: 2.75;
  opacity: 1;
}
.package-box__inner-edge-marker-shape {
  fill: var(--box-accent, #64748b);
}
.package-box__inner-edge-marker-shape--extends {
  fill: #1d4ed8;
}
.package-box__inner-edge-marker-shape--hastrait {
  fill: #9333ea;
}
.package-box__inner-edge-path--hastrait {
  stroke-dasharray: 8 3 2 3;
  stroke-width: 2.35;
}
.package-box__inner-edge-marker-shape--gets {
  fill: #d97706;
}
.package-box__inner-edge-marker-shape--creates {
  fill: #059669;
}
/**
 * `gets` edges are dashed so they read as a structural reference rather than an inheritance
 * relation — same arrow head as `extends`, but the dashed body makes the distinction obvious
 * even in grayscale / when hovered for emphasis.
 */
.package-box__inner-edge-path--gets {
  stroke-dasharray: 5 3;
}
.package-box__inner-edge-path--creates {
  stroke-dasharray: 2 2;
}
.package-box__inner-edge-label {
  paint-order: stroke fill;
  stroke: rgb(248 250 252);
  stroke-width: 3px;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.package-box__inner-edge-label--emph {
  opacity: 1 !important;
  font-weight: 600 !important;
}
.package-box__inner-artefact-cols {
  position: relative;
  z-index: 0;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: flex-start;
  justify-content: center;
  gap: clamp(18px, 5.5cqw, 36px);
  flex: 0 1 auto;
  min-height: min-content;
  min-width: 0;
  width: 100%;
  padding: 4px 0 10px;
  transition:
    flex 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    min-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    gap 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
/**
 * In artefact-focus mode the cols container stretches its children vertically so the focused
 * column can fill the sub-diagram band. Default mode keeps `align-items: flex-start` (rows are
 * natural-height and pack to the top, mirroring how packages stack their card list).
 *
 * The wide `gap` is intentional — inheritance edges use {@link getSmoothStepPath} (the same
 * routing strategy as Vue Flow `imports` / dependency edges between modules), and the middle
 * vertical segment of an L-shaped step path is drawn at the midpoint between source and target
 * X. Generous gap + slim peer columns mean that vertical segment runs through clear inter-column
 * space rather than through neighbour artefact rows.
 */
.package-box__inner-artefact-cols--artefact-focus {
  flex: 1 1 0;
  min-height: 0;
  align-items: stretch;
  gap: clamp(32px, 7cqw, 64px);
}
.package-box__inner-artefact-cols--with-packages {
  flex: 1 1 0;
  min-height: 0;
  align-items: stretch;
  justify-content: flex-start;
}
.package-box__inner-package-stack {
  flex: 0 0 clamp(156px, 22cqw, 232px);
  min-width: 0;
  min-height: 0;
  height: 100%;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
  gap: 10px;
}
.package-box__inner-slot--inner-package {
  flex: 1 1 0;
  min-height: clamp(132px, 24cqh, 240px);
  height: 100%;
}
.package-box__inner-slot--inner-package > .package-box.package-box--embedded {
  min-height: 100%;
}
.package-box__external-endpoints {
  flex: 0 0 96px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  align-self: stretch;
  min-width: 0;
}
.package-box__external-endpoints--left {
  align-items: flex-end;
}
.package-box__external-endpoints--right {
  align-items: flex-start;
}
.package-box__external-endpoint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.package-box__external-endpoint-chip {
  max-width: 88px;
  padding: 3px 8px;
  border: 1px dashed color-mix(in srgb, var(--box-accent) 24%, rgb(148 163 184));
  border-radius: 999px;
  background: rgb(255 255 255 / 0.92);
  color: #475569;
  font-size: 10px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.package-box__inner-artefact-col {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
  flex: 1 1 0;
  min-width: 0;
  min-height: min-content;
  max-width: min(100%, 220px);
  transition:
    flex 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    max-width 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    min-width 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.package-box__inner-artefact-cols--artefact-focus > .package-box__inner-artefact-col {
  min-height: 0;
}
/** Column containing the focused artefact: grows to take more horizontal space. */
.package-box__inner-artefact-col--focus {
  flex: 2.6 1 0;
  max-width: none;
  min-width: 0;
}
/**
 * Other inheritance layers stay visible at a slim width so the focused column dominates the
 * sub-diagram while parent traits / classes (left) and subclasses (right) remain readable.
 * Width is tuned so the `@container pkg-artefact-row (max-width: 118px)` rule below always
 * fires for peers — vertical title + icon-on-top, like a tight package-leaf card. The slim
 * silhouette also frees horizontal space for the inheritance edge step paths to route between
 * columns without crossing artefact rows.
 */
.package-box__inner-artefact-col--peer {
  flex: 0 1 auto;
  max-width: clamp(56px, 9cqw, 84px);
  min-width: 48px;
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
.package-box__inner-slot--artefact-panel {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  cursor: default;
}
.package-box__inner-slot--artefact {
  cursor: pointer;
}
/**
 * Stacked inner artefacts must not inherit `.package-box__inner-slot { flex: 1 1 0; min-height: 0 }`
 * (that rule wins over a single modifier earlier in the file — same specificity, later source).
 * Project-style “layers” here are LR columns of natural-height rows, not equal-height flex slices.
 */
.package-box__inner-slot.package-box__inner-slot--artefact-layer {
  flex: 0 0 auto;
  min-height: auto;
  align-self: stretch;
}
.package-box__inner-slot.package-box__inner-slot--artefact-layer .package-box__artefact-row {
  flex: 0 0 auto;
  min-height: auto;
}
/**
 * Focused-artefact cell — must override the `flex: 0 0 auto` collapse from
 * `.package-box__inner-slot--artefact-layer` directly above. Same specificity (two classes),
 * so we rely on source-order cascade — keep this block here, not earlier in the file.
 */
.package-box__inner-slot--artefact-layer.package-box__inner-slot--artefact-focused-cell {
  flex: 1 1 0;
  min-height: 0;
  align-self: stretch;
  cursor: pointer;
}
/**
 * Inner member strip — visual rhythm matches a {@link PackageBox} leaf card so a Scala member
 * row reads as the same kind of object as a package on the canvas:
 *   - same 1px `rgb(30 41 59 / 0.88)` border, same 8px radius, same drop shadow;
 *   - same **left accent strip** via `inset 5px 0 0 0 var(--box-accent)` (the slot wrapper sets
 *     `--box-accent` per artefact id, falling back to `boxColorForId(id)`);
 *   - icon-on-top + centered title when there's width, vertical title via `@container` below
 *     once the row gets narrow (peer columns during artefact focus).
 */
.package-box__artefact-row {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 8px 6px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  border-radius: 8px;
  border: 1px solid rgb(30 41 59 / 0.88);
  /**
   * Inner artefact rows reuse the accent-tinted 90% body fill from `.package-box` so a
   * row inside a focused package looks like a slim sibling card (color identity + slight
   * translucency over the inheritance edges routed underneath).
   */
  background: color-mix(
    in srgb,
    color-mix(in srgb, var(--box-accent, steelblue) 8%, #ffffff) 90%,
    transparent
  );
  box-shadow:
    inset 5px 0 0 0 var(--box-accent, steelblue),
    0 1px 2px rgb(15 23 42 / 0.08);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
  container-type: inline-size;
  container-name: pkg-artefact-row;
}
.package-box__artefact-row--has-metrics {
  padding-top: 20px;
}
.package-box__artefact-metrics {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  max-width: calc(100% - 18px);
  pointer-events: none;
}
/** Ridge handles (same idea as `.tg-handle-anchor` on Vue Flow modules). */
.package-box__artefact-anchor {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-sizing: border-box;
  background: var(--box-accent, #64748b);
  border: 1.5px solid color-mix(in srgb, var(--box-accent, #64748b) 72%, #0f172a);
  z-index: 2;
  pointer-events: none;
  opacity: 0.88;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    opacity 0.15s ease;
}
.package-box__artefact-anchor--in {
  left: -5px;
}
.package-box__artefact-anchor--out {
  right: -5px;
}
.package-box__artefact-anchor--emph {
  opacity: 1;
  box-shadow: 0 0 0 2px rgb(255 255 255 / 0.95);
}
.package-box__inner-slot--inner-hovered .package-box__artefact-row {
  border-color: var(--box-accent, #64748b);
  box-shadow:
    inset 5px 0 0 0 var(--box-accent, steelblue),
    0 0 0 1px rgb(255 255 255 / 0.85),
    0 0 0 2px var(--box-accent, #64748b),
    0 2px 8px rgb(15 23 42 / 0.08);
}
.lang-icon-slot--artefact {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: stretch;
  width: 100%;
  min-height: clamp(26px, min(20cqh, 36px), 36px);
  max-height: 40px;
  margin: 0;
  flex-shrink: 0;
  pointer-events: none;
}
.lang-icon-slot--artefact :deep(.lang-svg) {
  max-height: 30px;
  height: min(100%, 30px);
  width: auto;
}
.package-box__artefact-text {
  flex: 0 1 auto;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  text-align: center;
}
.package-box__artefact-title {
  font-weight: 600;
  font-size: clamp(0.72rem, min(1.6vmin, 2.4cqh), 0.95rem);
  color: #0f172a;
  line-height: 1.25;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.package-box__artefact-subtitle {
  font-size: clamp(0.62rem, min(1.35vmin, 2cqh), 0.8rem);
  color: #64748b;
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
/** Very narrow inner columns: vertical title like `.package-box--tight` (default row is already stacked). */
@container pkg-artefact-row (max-width: 118px) {
  .package-box__artefact-row {
    gap: 4px;
    padding: 6px 4px 5px 10px;
  }
  .package-box__artefact-row--has-metrics {
    padding-top: 40px;
  }
  .package-box__artefact-metrics {
    top: 4px;
    right: 4px;
    max-width: 40px;
  }
  .package-box__artefact-row .package-box__artefact-text {
    min-width: 0;
  }
  .package-box__artefact-row .package-box__artefact-title {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    text-orientation: mixed;
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
    max-width: none;
    line-height: 1.15;
    text-align: center;
    font-size: clamp(0.62rem, min(1.45vmin, 2.2cqh), 0.88rem);
  }
  .package-box__artefact-row .package-box__artefact-subtitle {
    display: none;
  }
  .package-box__artefact-row .lang-icon-slot--artefact {
    min-height: 28px;
    max-height: 32px;
  }
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

/** Inner stack row: same chrome as default top-level, slightly tighter. */
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
/**
 * Default `.lang-icon-slot` uses `align-self: center`, which shrink-wraps the slot to the icon
 * width in a column flex — inner cards then stay narrow with empty space on the right. Stretch
 * the icon row to the full inner-diagram width so each embedded package reads as a full-width tile.
 */
.package-box--embedded > .lang-icon-slot.lang-icon-slot--embedded {
  align-self: stretch;
  width: 100%;
  max-width: none;
  height: clamp(26px, min(22cqw, 16cqh), 56px);
  margin-bottom: 6px;
}
.package-box__body--embedded {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  align-self: stretch;
  justify-content: center;
}
.package-box--embedded .title {
  text-align: center;
}
.package-box--embedded .subtitle {
  text-align: center;
  margin-top: 4px;
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
  top: 5px;
  right: 5px;
  z-index: 4;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 5px;
  max-width: calc(100% - 10px);
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
  font-size: clamp(0.78rem, min(2.2vmin, 3.5cqh), 1.35rem);
  color: #0f172a;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  transition:
    font-size 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.subtitle {
  margin-top: clamp(2px, 0.6vmin, 8px);
  font-size: clamp(0.65rem, min(1.6vmin, 2.5cqh), 0.95rem);
  color: #475569;
  line-height: 1.25;
  opacity: 1;
  max-height: 80px;
  overflow: hidden;
  transition:
    opacity 0.4s ease,
    margin-top 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    max-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.4s ease;
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
