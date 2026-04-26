import { computed, nextTick, onUnmounted, ref, type Ref } from 'vue'
import { buildAnchoredSmoothStepRelationDraws } from '../../graph/anchoredSmoothStepRelations'
import { dependencyEdgeLabelStyle } from '../../graph/edgeTheme'
import type { TritonInnerArtefactRelationSpec } from '../../ilograph/types'
import {
  innerArtefactEdgeDisplayLabel,
  innerArtefactRelationStroke,
  type BoundaryStubRelation,
  type InnerEdgeDraw,
  type RoutedInnerRelation,
} from './innerArtefactGraphHelpers'

type InnerArtefactEdgesOptions = {
  boxId: () => string
  diagramRef: Ref<HTMLElement | null>
  routedCrossPackageBridgeRelations: () => readonly RoutedInnerRelation[]
  crossPackageBoundaryStubRelations: () => readonly BoundaryStubRelation[]
  innerArtefactRelationList: () => readonly TritonInnerArtefactRelationSpec[]
  updateScrollMetrics: () => void
}

const INNER_EDGE_LAYOUT_SETTLE_MS = 480
const INNER_EDGE_CARD_SELECTOR = '.diagram-leaf-box, .general-focused-box, .package-box'
const INNER_EDGE_ANCHOR_SELECTOR = '.package-box__artefact-anchor'

export function useInnerArtefactEdges(options: InnerArtefactEdgesOptions) {
  const innerEdgeDraws = ref<InnerEdgeDraw[]>([])
  const innerArtefactSlotEls = new Map<string, HTMLElement>()
  const innerHoverEdgeId = ref<string | null>(null)
  const innerHoverArtId = ref<string | null>(null)

  const routedOverlayInnerEdgeDraws = computed(() => innerEdgeDraws.value.filter((draw) => draw.overlay))
  const emphasizedInnerEdgeDraws = computed(() =>
    innerEdgeDraws.value.filter((draw) => !draw.overlay && innerEdgeEmphasized(draw)),
  )
  const normalInnerEdgeDraws = computed(() =>
    innerEdgeDraws.value.filter((draw) => !draw.overlay && !innerEdgeEmphasized(draw)),
  )

  function innerEdgeLabelSvgStyleFor(draw: InnerEdgeDraw): Record<string, string> {
    const s = dependencyEdgeLabelStyle(draw.stroke, innerEdgeEmphasized(draw))
    return {
      fill: String(s.fill ?? draw.stroke),
      fontSize: String(s.fontSize ?? '11px'),
      fontWeight: String(s.fontWeight ?? '500'),
      opacity: String(s.opacity ?? '0.88'),
    }
  }

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
    if (el instanceof HTMLElement) {
      const directAnchor = Array.from(el.children).some((child) =>
        child instanceof HTMLElement && child.matches(INNER_EDGE_ANCHOR_SELECTOR),
      )
      const card = directAnchor || el.matches(INNER_EDGE_CARD_SELECTOR)
        ? el
        : el.querySelector(INNER_EDGE_CARD_SELECTOR)
      innerArtefactSlotEls.set(artId, card instanceof HTMLElement ? card : el)
    } else innerArtefactSlotEls.delete(artId)
    scheduleInnerEdgeRefreshSettled()
  }

  function refreshInnerArtefactEdges() {
    const root = options.diagramRef.value
    const rels: RoutedInnerRelation[] = [
      ...options.routedCrossPackageBridgeRelations(),
      ...options.crossPackageBoundaryStubRelations().map((rel) => ({
        from: rel.side === 'left' ? rel.externalId : rel.localId,
        to: rel.side === 'left' ? rel.localId : rel.externalId,
        label: rel.label,
        wrapperName: rel.wrapperName,
        displayLabel: innerArtefactEdgeDisplayLabel(innerArtefactRelationStroke(rel.label).kind, rel.wrapperName),
        overlay: false,
      })),
      ...options.innerArtefactRelationList().map((rel) => ({
        from: rel.from,
        to: rel.to,
        label: rel.label,
        wrapperName: rel.wrapperName,
        displayLabel: innerArtefactEdgeDisplayLabel(innerArtefactRelationStroke(rel.label).kind, rel.wrapperName),
        overlay: false,
      })),
    ]
    if (!root || !rels.length) {
      innerEdgeDraws.value = []
      return
    }
    const sharedDraws = buildAnchoredSmoothStepRelationDraws({
      rootEl: root,
      relations: rels.map((rel, index) => ({
        id: `ie-${options.boxId()}-${index}`,
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
        displayLabel: rel.displayLabel ?? '',
        kind,
        stroke,
        from: geom.from,
        to: geom.to,
        overlay: !!rel.overlay,
      })
    }
    innerEdgeDraws.value = out
  }

  let innerArtefactRo: ResizeObserver | null = null
  let innerArtefactHostRo: ResizeObserver | null = null
  let innerEdgeRaf = 0
  let innerEdgeSettleTimer: ReturnType<typeof setTimeout> | null = null
  const innerEdgeBurstTimers = new Set<ReturnType<typeof setTimeout>>()

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
    for (const timer of innerEdgeBurstTimers) clearTimeout(timer)
    innerEdgeBurstTimers.clear()
    void nextTick(() => {
      scheduleInnerEdgeRefresh()
      requestAnimationFrame(() => {
        scheduleInnerEdgeRefresh()
        requestAnimationFrame(() => scheduleInnerEdgeRefresh())
      })
    })
    for (const delay of [120, 240, 360, 520]) {
      const timer = setTimeout(() => {
        innerEdgeBurstTimers.delete(timer)
        refreshInnerArtefactEdges()
      }, delay)
      innerEdgeBurstTimers.add(timer)
    }
    innerEdgeSettleTimer = setTimeout(() => {
      innerEdgeSettleTimer = null
      refreshInnerArtefactEdges()
      options.updateScrollMetrics()
    }, INNER_EDGE_LAYOUT_SETTLE_MS)
  }

  function observeInnerArtefactDiagram(el: HTMLElement | null) {
    innerArtefactRo?.disconnect()
    innerArtefactRo = null
    if (el) {
      innerArtefactRo = new ResizeObserver(() => {
        scheduleInnerEdgeRefresh()
        options.updateScrollMetrics()
      })
      innerArtefactRo.observe(el)
      scheduleInnerEdgeRefreshSettled()
      options.updateScrollMetrics()
    }
  }

  function observeInnerArtefactHost(el: HTMLElement | null) {
    innerArtefactHostRo?.disconnect()
    innerArtefactHostRo = null
    if (el) {
      innerArtefactHostRo = new ResizeObserver(() => scheduleInnerEdgeRefreshSettled())
      innerArtefactHostRo.observe(el)
    }
  }

  function cleanupInnerArtefactEdges() {
    innerArtefactRo?.disconnect()
    innerArtefactRo = null
    innerArtefactHostRo?.disconnect()
    innerArtefactHostRo = null
    if (innerEdgeRaf) {
      cancelAnimationFrame(innerEdgeRaf)
      innerEdgeRaf = 0
    }
    if (innerEdgeSettleTimer != null) {
      clearTimeout(innerEdgeSettleTimer)
      innerEdgeSettleTimer = null
    }
    for (const timer of innerEdgeBurstTimers) clearTimeout(timer)
    innerEdgeBurstTimers.clear()
    innerArtefactSlotEls.clear()
    innerHoverEdgeId.value = null
    innerHoverArtId.value = null
  }

  onUnmounted(cleanupInnerArtefactEdges)

  return {
    innerEdgeDraws,
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
    cleanupInnerArtefactEdges,
  }
}
