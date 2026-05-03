/**
 * Square footprint (px) for the language / folder / kind badge in diagram node chrome. Leaf
 * minimum width and height, layout floors, and header icon slots all derive from this so the
 * box never shrinks below the logo in either axis.
 */
export const DIAGRAM_LOGO_BOX_PX = 40

export const DIAGRAM_LEAF_MIN_WIDTH_PX = DIAGRAM_LOGO_BOX_PX
export const DIAGRAM_LEAF_MIN_HEIGHT_PX = DIAGRAM_LOGO_BOX_PX

/**
 * Flow `type: 'artefact'` leaves (Scala class / trait / object cards): smaller footprint than
 * dependency-column {@link MODULE_W} / full-viewport singleton packages so artefacts read as
 * compact members, not full canvas tiles.
 */
export const DIAGRAM_ARTEFACT_PREFERRED_WIDTH_PX = 176
export const DIAGRAM_ARTEFACT_PREFERRED_HEIGHT_PX = 112

/**
 * Inline width at which BoxMetricStrip stacks its rows (`@container (max-width: 150px)`).
 * Hysteresis: enter at METRICS_STRIP_BREAK_ENTER_PX, stay in break until width reaches
 * METRICS_STRIP_BREAK_EXIT_PX so ResizeObserver does not thrash at the CSS boundary.
 */
export const METRICS_STRIP_BREAK_ENTER_PX = 150
/** Just above the 150px container breakpoint so we leave break shortly after the strip un-stacks. */
export const METRICS_STRIP_BREAK_EXIT_PX = 152

/**
 * Tall slim cells: when height clearly exceeds width but the track is still fairly narrow,
 * use the same metrics-break chrome as width-only break.
 */
export const METRICS_BREAK_PORTRAIT_MIN_H_PX = 72
/** Integer permille `(1000 * height / width)` — enter when >= 1180 (~1.18). */
export const METRICS_BREAK_PORTRAIT_ENTER_PERMILLE = 1180
export const METRICS_BREAK_PORTRAIT_EXIT_PERMILLE = 1060
export const METRICS_BREAK_PORTRAIT_MAX_W_ENTER_PX = 240
export const METRICS_BREAK_PORTRAIT_MAX_W_EXIT_PX = 268

/**
 * Wide but not tall enough for stacked default chrome: corner folder + metric strip (same as narrow
 * break) so subtitle stays in-flow. Hysteresis mirrors other layout bands.
 */
export const METRICS_BREAK_SHALLOW_ENTER_H_PX = 118
export const METRICS_BREAK_SHALLOW_EXIT_H_PX = 130
export const METRICS_BREAK_SHALLOW_MIN_WIDTH_PX = 128
export const METRICS_BREAK_SHALLOW_MIN_WIDTH_EXIT_PX = 120

/**
 * Chrome widths used by slim metrics layouts: the pinned language logo uses {@link DIAGRAM_LOGO_BOX_PX}
 * and one metric chip is 36px wide. The slim layout begins once those two can sit side-by-side.
 */
export const SLIM_LAYOUT_LOGO_WIDTH_PX = DIAGRAM_LOGO_BOX_PX
export const SLIM_LAYOUT_METRIC_CHIP_WIDTH_PX = 36
export const SLIM_LAYOUT_MIN_WIDTH_PX = SLIM_LAYOUT_LOGO_WIDTH_PX + SLIM_LAYOUT_METRIC_CHIP_WIDTH_PX
export const SLIM_LAYOUT_MIN_WIDTH_EXIT_PX = SLIM_LAYOUT_MIN_WIDTH_PX + 8

/**
 * Width hysteresis: below this band the slim rails have room for chrome, but not enough useful
 * content space for title + subtitle. Use one title rail only.
 */
export const SUPERSLIM_LAYOUT_ENTER_PX = 96
export const SUPERSLIM_LAYOUT_EXIT_PX = 104

/**
 * Wide shallow nodes (e.g. ~167×101): stacked default chrome clips subtitle under `overflow:hidden`.
 * Flat row layout fits title + metrics summary in one short band — keep in sync with breakpoint dojo
 * `flat-layout` sample max height in {@link App.vue}.
 */
export const FLAT_LAYOUT_MAX_H_PX = 112
export const FLAT_LAYOUT_EXIT_H_PX = 122
export const FLAT_LAYOUT_MIN_WIDTH_PX = 128
export const FLAT_LAYOUT_MIN_WIDTH_EXIT_PX = FLAT_LAYOUT_MIN_WIDTH_PX - 8

export const SUPERFLAT_LAYOUT_MAX_H_PX = 58
export const SUPERFLAT_LAYOUT_EXIT_H_PX = 66

export const TIGHT_LAYOUT_MIN_WIDTH_PX = 176
export const TIGHT_LAYOUT_MAX_WIDTH_PX = 240

export const DEFAULT_LAYOUT_MIN_WIDTH_PX = 268
export const DEFAULT_LAYOUT_MIN_HEIGHT_PX = 170
export const COMPACT_LAYOUT_MIN_WIDTH_PX = TIGHT_LAYOUT_MAX_WIDTH_PX + 1
export const COMPACT_LAYOUT_MAX_WIDTH_PX = 520
export const COMPACT_LAYOUT_MIN_HEIGHT_PX = FLAT_LAYOUT_MAX_H_PX + 1
export const COMPACT_LAYOUT_MAX_HEIGHT_PX = DEFAULT_LAYOUT_MIN_HEIGHT_PX - 1

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

  const shallowEnter =
    h <= METRICS_BREAK_SHALLOW_ENTER_H_PX &&
    w >= METRICS_BREAK_SHALLOW_MIN_WIDTH_PX &&
    w > METRICS_STRIP_BREAK_EXIT_PX
  const shallowStay =
    h < METRICS_BREAK_SHALLOW_EXIT_H_PX && w >= METRICS_BREAK_SHALLOW_MIN_WIDTH_EXIT_PX

  if (prev) {
    const narrowStay = w < METRICS_STRIP_BREAK_EXIT_PX
    return narrowStay || portraitStay || shallowStay
  }
  const narrowEnter = w <= METRICS_STRIP_BREAK_ENTER_PX
  return narrowEnter || portraitEnter || shallowEnter
}

export function nextSuperslimLayout(
  boxWidthPx: number,
  prev: boolean,
): boolean {
  if (prev) return boxWidthPx < SUPERSLIM_LAYOUT_EXIT_PX
  return boxWidthPx <= SUPERSLIM_LAYOUT_ENTER_PX
}

export function nextFlatLayout(boxWidthPx: number, boxHeightPx: number, prev: boolean): boolean {
  if (prev) return boxWidthPx >= FLAT_LAYOUT_MIN_WIDTH_EXIT_PX && boxHeightPx <= FLAT_LAYOUT_EXIT_H_PX
  return boxWidthPx >= FLAT_LAYOUT_MIN_WIDTH_PX && boxHeightPx <= FLAT_LAYOUT_MAX_H_PX
}

export function nextSuperflatLayout(boxWidthPx: number, boxHeightPx: number, prev: boolean): boolean {
  if (prev) return boxWidthPx >= FLAT_LAYOUT_MIN_WIDTH_EXIT_PX && boxHeightPx <= SUPERFLAT_LAYOUT_EXIT_H_PX
  return boxWidthPx >= FLAT_LAYOUT_MIN_WIDTH_PX && boxHeightPx <= SUPERFLAT_LAYOUT_MAX_H_PX
}

export function nextCompactLayout(boxWidthPx: number, boxHeightPx: number): boolean {
  return (
    boxWidthPx >= COMPACT_LAYOUT_MIN_WIDTH_PX &&
    boxHeightPx >= COMPACT_LAYOUT_MIN_HEIGHT_PX &&
    boxHeightPx <= COMPACT_LAYOUT_MAX_HEIGHT_PX
  )
}

export function nextTightLayout(boxWidthPx: number, boxHeightPx: number): boolean {
  return (
    boxWidthPx >= TIGHT_LAYOUT_MIN_WIDTH_PX &&
    boxWidthPx <= TIGHT_LAYOUT_MAX_WIDTH_PX &&
    boxHeightPx > FLAT_LAYOUT_MAX_H_PX
  )
}
