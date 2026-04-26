/**
 * Width hysteresis: below {@link METRICS_BREAK_SUPER_SLIM_ENTER_PX}, logo + stacked metrics
 * overlap horizontally — use superslim column (metrics → logo → title, no subtitle).
 */
export const METRICS_BREAK_SUPER_SLIM_ENTER_PX = 172
export const METRICS_BREAK_SUPER_SLIM_EXIT_PX = 186

export function nextMetricsBreakSuperslim(boxWidthPx: number, prev: boolean): boolean {
  if (prev) return boxWidthPx < METRICS_BREAK_SUPER_SLIM_EXIT_PX
  return boxWidthPx <= METRICS_BREAK_SUPER_SLIM_ENTER_PX
}
