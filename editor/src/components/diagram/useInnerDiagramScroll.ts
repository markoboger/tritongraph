import { computed, onUnmounted, ref, type Ref } from 'vue'

export function useInnerDiagramScroll(options: {
  containerRef: Ref<HTMLElement | null>
  colsRef: Ref<HTMLElement | null>
}) {
  const innerScrollX = ref(0)
  const innerScrollY = ref(0)
  const innerContentW = ref(0)
  const innerViewportW = ref(0)
  const innerContentH = ref(0)
  const innerViewportH = ref(0)

  function updateInnerScrollMetrics() {
    const cols = options.colsRef.value
    const container = options.containerRef.value
    if (!cols || !container) return
    innerViewportW.value = container.clientWidth
    innerViewportH.value = container.clientHeight
    innerContentW.value = cols.scrollWidth
    innerContentH.value = cols.scrollHeight
    const maxX = Math.max(0, innerContentW.value - innerViewportW.value)
    const maxY = Math.max(0, innerContentH.value - innerViewportH.value)
    if (-innerScrollX.value > maxX) innerScrollX.value = -maxX
    if (-innerScrollY.value > maxY) innerScrollY.value = -maxY
  }

  const innerHScrollNeeded = computed(() => innerContentW.value > innerViewportW.value + 4)
  const innerVScrollNeeded = computed(() => innerContentH.value > innerViewportH.value + 4)

  const innerHThumbFraction = computed(() =>
    !innerHScrollNeeded.value ? 1 : Math.max(0.06, innerViewportW.value / innerContentW.value),
  )
  const innerVThumbFraction = computed(() =>
    !innerVScrollNeeded.value ? 1 : Math.max(0.06, innerViewportH.value / innerContentH.value),
  )
  const innerHScrollRatio = computed(() => {
    const span = innerContentW.value - innerViewportW.value
    return span > 0 ? (-innerScrollX.value / span) * 1000 : 0
  })
  const innerVScrollRatio = computed(() => {
    const span = innerContentH.value - innerViewportH.value
    return span > 0 ? (-innerScrollY.value / span) * 1000 : 0
  })
  const innerVThumbStyle = computed(() => {
    const t = innerVScrollRatio.value / 1000
    const frac = innerVThumbFraction.value
    return { top: `${(t * (1 - frac) * 100).toFixed(3)}%`, height: `${(frac * 100).toFixed(3)}%` }
  })
  const innerHThumbStyle = computed(() => {
    const t = innerHScrollRatio.value / 1000
    const frac = innerHThumbFraction.value
    return { left: `${(t * (1 - frac) * 100).toFixed(3)}%`, width: `${(frac * 100).toFixed(3)}%` }
  })

  function maxScrollX(): number {
    return Math.max(0, innerContentW.value - innerViewportW.value)
  }

  function maxScrollY(): number {
    return Math.max(0, innerContentH.value - innerViewportH.value)
  }

  function onInnerWheel(ev: WheelEvent) {
    if (!innerHScrollNeeded.value && !innerVScrollNeeded.value) return
    ev.preventDefault()
    ev.stopPropagation()
    const factor = ev.deltaMode === 2 ? 300 : ev.deltaMode === 1 ? 20 : 1
    const dx = ev.deltaX * factor
    const dy = ev.deltaY * factor
    innerScrollX.value = Math.max(-maxScrollX(), Math.min(0, innerScrollX.value - dx))
    innerScrollY.value = Math.max(-maxScrollY(), Math.min(0, innerScrollY.value - dy))
  }

  let innerPanDrag: { startX: number; startY: number; startScrollX: number; startScrollY: number } | null = null

  function onInnerPointerDown(ev: PointerEvent) {
    if (ev.button !== 0) return
    if (!(ev.target instanceof Element)) return
    if (ev.target.closest('.package-box__inner-slot')) return
    if (!innerHScrollNeeded.value && !innerVScrollNeeded.value) return
    innerPanDrag = {
      startX: ev.clientX,
      startY: ev.clientY,
      startScrollX: innerScrollX.value,
      startScrollY: innerScrollY.value,
    }
    window.addEventListener('pointermove', onInnerPointerMove, { capture: true })
    window.addEventListener('pointerup', onInnerPointerUp, { capture: true })
  }

  function onInnerPointerMove(ev: PointerEvent) {
    if (!innerPanDrag) return
    const dx = ev.clientX - innerPanDrag.startX
    const dy = ev.clientY - innerPanDrag.startY
    innerScrollX.value = Math.max(-maxScrollX(), Math.min(0, innerPanDrag.startScrollX + dx))
    innerScrollY.value = Math.max(-maxScrollY(), Math.min(0, innerPanDrag.startScrollY + dy))
  }

  function onInnerPointerUp() {
    innerPanDrag = null
    window.removeEventListener('pointermove', onInnerPointerMove, true)
    window.removeEventListener('pointerup', onInnerPointerUp, true)
  }

  function onInnerHSliderInput(ev: Event) {
    const t = Number((ev.target as HTMLInputElement).value) / 1000
    innerScrollX.value = -maxScrollX() * t
  }

  function onInnerVSliderInput(ev: Event) {
    const t = Number((ev.target as HTMLInputElement).value) / 1000
    innerScrollY.value = -maxScrollY() * t
  }

  function resetInnerScroll() {
    innerScrollX.value = 0
    innerScrollY.value = 0
  }

  onUnmounted(() => {
    onInnerPointerUp()
  })

  return {
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
    onInnerPointerUp,
    resetInnerScroll,
  }
}
