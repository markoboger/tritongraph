/**
 * Minimum width Vue Flow leaf nodes may shrink to — matches the pinned icon column (~40px badge
 * + 2–4px inset). {@link NodeResizer} on {@link FlowProjectNode} / {@link FlowPackageNode} uses this.
 */
export const DIAGRAM_LEAF_MIN_WIDTH_PX = 44

/**
 * Inline width at which {@link BoxMetricStrip} stacks its rows (`@container (max-width: 150px)`).
 * Hysteresis: enter at {@link METRICS_STRIP_BREAK_ENTER_PX}, stay in break until width reaches
 * {@link METRICS_STRIP_BREAK_EXIT_PX} so ResizeObserver does not thrash at the CSS boundary.
 *
 * **Important:** when `prev` is true, the layout must *remain* break while the box is still
 * narrow (`width < EXIT`). The previous `>= EXIT` check was inverted and flipped break off on
 * every remeasure while narrow, causing logo jitter.
 */
export const METRICS_STRIP_BREAK_ENTER_PX = 150
/** Just above the 150px container breakpoint so we leave break shortly after the strip un-stacks. */
export const METRICS_STRIP_BREAK_EXIT_PX = 152

/**
 * Tall **slim** cells: when height clearly exceeds width but the track is still fairly narrow,
 * use the same metrics-break chrome (vertical title rails) as width-only break — without this,
 * only {@link METRICS_STRIP_BREAK_ENTER_PX} applied and wide short labels stayed horizontal.
 *
 * Width is capped so very wide portrait cards do not pick up narrow-column chrome.
 */
export const METRICS_BREAK_PORTRAIT_MIN_H_PX = 72
/** Integer permille `(1000 * height / width)` — enter when ≥ 1180 (~1.18). */
export const METRICS_BREAK_PORTRAIT_ENTER_PERMILLE = 1180
export const METRICS_BREAK_PORTRAIT_EXIT_PERMILLE = 1060
export const METRICS_BREAK_PORTRAIT_MAX_W_ENTER_PX = 240
export const METRICS_BREAK_PORTRAIT_MAX_W_EXIT_PX = 268

export function nextMetricsBreakLayout(boxWidthPx: number, boxHeightPx: number, prev: boolean): boolean {
  const w = boxWidthPx
  const h = boxHeightPx
  const denom = Math.max(1, w)
  const permille = h > 0 ? Math.floor((1000 * h) / denom) : 0

  const portraitEnter =
    h >= METRICS_BREAK_PORTRAIT_MIN_H_PX &&
    w <= METRICS_BREAK_PORTRAIT_MAX_W_ENTER_PX &&
    permille >= METRICS_BREAK_PORTRAIT_ENTER_PERMILLE
  const portraitStay =
    h >= METRICS_BREAK_PORTRAIT_MIN_H_PX &&
    w < METRICS_BREAK_PORTRAIT_MAX_W_EXIT_PX &&
    permille >= METRICS_BREAK_PORTRAIT_EXIT_PERMILLE

  if (prev) {
    const narrowStay = w < METRICS_STRIP_BREAK_EXIT_PX
    return narrowStay || portraitStay
  }
  const narrowEnter = w <= METRICS_STRIP_BREAK_ENTER_PX
  return narrowEnter || portraitEnter
}
