import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { nextCompactLayout, nextFlatLayout, nextMetricsBreakLayout, nextSuperflatLayout, nextSuperslimLayout } from './boxChromeLayout'

type PackageBoxChromeLayoutOptions = {
  embedded: () => boolean
  focused: () => boolean
  forceCompactHeader?: () => boolean
  label: () => string
  hasCoverage: () => boolean
  issueCount: () => number
  watchSources: () => readonly unknown[]
}

export function usePackageBoxChromeLayout(options: PackageBoxChromeLayoutOptions) {
  const rootEl = ref<HTMLElement | null>(null)
  const titleEl = ref<HTMLElement | null>(null)
  const packageBodyEl = ref<HTMLElement | null>(null)

  const tightLayout = ref(false)
  const flatLayout = ref(false)
  const superflatLayout = ref(false)
  const compactLayout = ref(false)
  const metricsBreakLayout = ref(false)
  const superslimLayout = ref(false)
  const slimLayout = ref(false)

  const subtitleHiddenForVerticalTitle = computed(() => {
    if (compactLayout.value) return true
    if (superflatLayout.value) return true
    if (superslimLayout.value) return true
    if (metricsBreakLayout.value && slimLayout.value) return false
    return tightLayout.value
  })

  function applyMetricsBreakLayout(root: HTMLElement | null) {
    if (!root) {
      metricsBreakLayout.value = false
      return
    }
    const hasMetricsChrome = options.hasCoverage() || options.issueCount() >= 0
    metricsBreakLayout.value = hasMetricsChrome
      ? nextMetricsBreakLayout(root.clientWidth, root.clientHeight, metricsBreakLayout.value)
      : false
  }

  function syncMetricsBreakChrome(root: HTMLElement | null) {
    if (!root || !metricsBreakLayout.value) {
      superslimLayout.value = false
      slimLayout.value = false
      return
    }
    const w = root.clientWidth
    superslimLayout.value = nextSuperslimLayout(w, superslimLayout.value)
    if (superslimLayout.value) {
      slimLayout.value = false
      return
    }
    slimLayout.value = true
  }

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

  const TITLE_TIGHT_ENTER = 4
  const TITLE_TIGHT_EXIT = 14

  function measure() {
    if (options.embedded()) {
      tightLayout.value = false
      flatLayout.value = false
      superflatLayout.value = false
      compactLayout.value = false
      applyMetricsBreakLayout(rootEl.value)
      syncMetricsBreakChrome(rootEl.value)
      return
    }
    if (options.focused()) {
      tightLayout.value = false
      flatLayout.value = false
      superflatLayout.value = false
      compactLayout.value = false
      metricsBreakLayout.value = false
      superslimLayout.value = false
      slimLayout.value = false
      return
    }
    if (options.forceCompactHeader?.()) {
      tightLayout.value = false
      flatLayout.value = false
      superflatLayout.value = false
      compactLayout.value = true
      metricsBreakLayout.value = false
      superslimLayout.value = false
      slimLayout.value = false
      return
    }
    const root = rootEl.value
    const title = titleEl.value
    if (root) {
      const rect = root.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      superflatLayout.value = nextSuperflatLayout(w, h, superflatLayout.value)
      flatLayout.value = superflatLayout.value || nextFlatLayout(w, h, flatLayout.value)
      compactLayout.value = !flatLayout.value && nextCompactLayout(w, h)
      if (flatLayout.value) {
        metricsBreakLayout.value = false
        superslimLayout.value = false
        slimLayout.value = false
        tightLayout.value = false
        return
      }
      if (compactLayout.value) {
        metricsBreakLayout.value = false
        superslimLayout.value = false
        slimLayout.value = false
        tightLayout.value = false
        return
      }
    }
    applyMetricsBreakLayout(root)
    syncMetricsBreakChrome(root)
    if (!root || !title) return

    if (metricsBreakLayout.value) {
      flatLayout.value = false
      superflatLayout.value = false
      compactLayout.value = false
    }

    if (metricsBreakLayout.value) {
      tightLayout.value = false
      return
    }
    const label = String(options.label() ?? '')
    const padX =
      parseFloat(getComputedStyle(root).paddingLeft) + parseFloat(getComputedStyle(root).paddingRight)
    const availW = Math.max(0, root.clientWidth - padX - 14)
    const tw = measureTitleWidth(label, title)
    const titleDemandsTight = tightLayout.value
      ? tw > availW - TITLE_TIGHT_EXIT
      : tw > availW + TITLE_TIGHT_ENTER
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

  function cleanupChromeLayout() {
    if (measureRaf) {
      cancelAnimationFrame(measureRaf)
      measureRaf = 0
    }
    ro?.disconnect()
    ro = null
  }

  onMounted(() => {
    void nextTick(() => measure())
  })

  onUnmounted(cleanupChromeLayout)

  watch(
    options.watchSources,
    () => void nextTick(measure),
  )

  watch(packageBodyEl, (body) => {
    if (!body || !rootEl.value) return
    const r = ro
    if (r) r.observe(body)
  })

  watch(
    rootEl,
    (el) => {
      ro?.disconnect()
      ro = null
      if (el) {
        const observer = new ResizeObserver(() => scheduleMeasure())
        ro = observer
        observer.observe(el)
        void nextTick(() => {
          if (packageBodyEl.value) observer.observe(packageBodyEl.value)
          measure()
        })
      }
    },
    { flush: 'post' },
  )

  return {
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
    measure,
    scheduleMeasure,
    cleanupChromeLayout,
  }
}
