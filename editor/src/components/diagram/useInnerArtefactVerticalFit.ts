import { onUnmounted, watch, type Ref } from 'vue'
import { distributeHeightsToBand } from '../../graph/layoutDependencyLayers'
import {
  INNER_ARTEFACT_SLOT_MIN_HEIGHT_PX,
  INNER_ARTEFACT_VERTICAL_GAP_PX,
  innerArtefactSlotPreferredHeightPx,
} from './innerArtefactSlotMetrics'

export type InnerArtefactVerticalFitOptions = {
  colsRef: Ref<HTMLElement | null>
  /**
   * Bounded inner-artefact viewport (`.package-box__inner-artefact-diagram`). Column nodes often
   * use `min-height: min-content`, so their `clientHeight` tracks content; this element’s
   * `clientHeight` is the real vertical budget from the flex parent.
   */
  containerRef: Ref<HTMLElement | null>
  /** When false, inline slot heights are cleared (default CSS / preferred sizes apply). */
  enabled: () => boolean
  /** Layer columns: each entry is a column of inner-artefact ids (top → bottom). */
  columns: () => readonly (readonly string[])[]
  labelForArtId: (id: string) => string | undefined
  gapPx?: number
  /** After mutating slot box metrics (re-measure inner scroll rails). */
  onAfterSlotHeights?: () => void
}

function clearSlotStyles(slots: readonly HTMLElement[]): void {
  for (const el of slots) {
    el.style.height = ''
    el.style.flexBasis = ''
    el.style.flexGrow = ''
    el.style.flexShrink = ''
    el.style.minHeight = ''
  }
}

function clearArtefactSlotInlineHeights(cols: HTMLElement): void {
  const slots = cols.querySelectorAll<HTMLElement>(
    ':scope > .package-box__inner-artefact-col .package-box__inner-slot.package-box__inner-slot--artefact-layer',
  )
  clearSlotStyles([...slots])
}

/**
 * When a package’s inner-artefact column is shorter than the sum of preferred slot heights,
 * shrink slots vertically (same distribution idea as {@link distributeHeightsToBand} for stacked
 * groups in the dependency layout) instead of relying on inner panning first.
 */
export function useInnerArtefactVerticalFit(options: InnerArtefactVerticalFitOptions) {
  const gap = options.gapPx ?? INNER_ARTEFACT_VERTICAL_GAP_PX
  let ro: ResizeObserver | null = null

  function applyHeights(): void {
    const cols = options.colsRef.value
    if (!cols || !options.enabled()) {
      if (cols) clearArtefactSlotInlineHeights(cols)
      options.onAfterSlotHeights?.()
      return
    }

    const colEls = cols.querySelectorAll<HTMLElement>(
      ':scope > .package-box__inner-artefact-col',
    )
    const columnIds = options.columns()
    if (!colEls.length || !columnIds.length || colEls.length !== columnIds.length) {
      clearArtefactSlotInlineHeights(cols)
      options.onAfterSlotHeights?.()
      return
    }

    const viewport = options.containerRef.value
    const diagramH = viewport instanceof HTMLElement ? viewport.clientHeight : 0
    const colsCs = getComputedStyle(cols)
    const colsPadY = (parseFloat(colsCs.paddingTop) || 0) + (parseFloat(colsCs.paddingBottom) || 0)
    const maxStackHFromDiagram = Math.max(0, diagramH - colsPadY)

    for (let ci = 0; ci < colEls.length; ci++) {
      const colEl = colEls[ci]
      const artIds = columnIds[ci]
      if (!colEl || !artIds?.length) continue

      const slots = Array.from(
        colEl.querySelectorAll<HTMLElement>(':scope > .package-box__inner-slot.package-box__inner-slot--artefact-layer'),
      )
      if (slots.length !== artIds.length) {
        clearSlotStyles(slots)
        continue
      }

      const cs = getComputedStyle(colEl)
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      const colInnerH = Math.max(0, colEl.clientHeight - padY)
      const innerH = Math.min(colInnerH, maxStackHFromDiagram)
      if (innerH < 8) {
        clearSlotStyles(slots)
        continue
      }

      const natural = artIds.map((id) => innerArtefactSlotPreferredHeightPx(options.labelForArtId(id)))
      const mins = artIds.map(() => INNER_ARTEFACT_SLOT_MIN_HEIGHT_PX)
      const gapTotal = Math.max(0, artIds.length - 1) * gap
      const naturalSum = natural.reduce((a, b) => a + b, 0) + gapTotal

      if (naturalSum <= innerH + 2) {
        clearSlotStyles(slots)
        continue
      }

      const avail = Math.max(0, innerH - gapTotal)
      const fitted = distributeHeightsToBand(avail, natural, mins)
      for (let i = 0; i < artIds.length; i++) {
        const h = fitted[i]!
        const el = slots[i]!
        el.style.flexGrow = '0'
        el.style.flexShrink = '0'
        el.style.flexBasis = `${h}px`
        el.style.height = `${h}px`
        el.style.minHeight = `${h}px`
      }
    }

    options.onAfterSlotHeights?.()
  }

  function scheduleApply(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => applyHeights())
    })
  }

  watch(
    () => ({
      cols: options.colsRef.value,
      container: options.containerRef.value,
      enabled: options.enabled(),
      sig: JSON.stringify(options.columns()),
    }),
    () => scheduleApply(),
    { flush: 'post' },
  )

  watch(
    () => [options.colsRef.value, options.containerRef.value] as const,
    ([colsEl, containerEl]) => {
      ro?.disconnect()
      ro = null
      ro = new ResizeObserver(() => scheduleApply())
      if (colsEl instanceof HTMLElement) ro.observe(colsEl)
      if (containerEl instanceof HTMLElement) ro.observe(containerEl)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    ro?.disconnect()
    ro = null
    const c = options.colsRef.value
    if (c) clearArtefactSlotInlineHeights(c)
  })

  return { scheduleApplyInnerArtefactVerticalFit: scheduleApply }
}
