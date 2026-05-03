import { DIAGRAM_LOGO_BOX_PX } from './boxChromeLayout'

/** Vertical gap between stacked inner-artefact slots (matches `.package-box__inner-artefact-col` gap). */
export const INNER_ARTEFACT_VERTICAL_GAP_PX = 8

/** Minimum slot height when compressing — same floor as the diagram logo box. */
export const INNER_ARTEFACT_SLOT_MIN_HEIGHT_PX = DIAGRAM_LOGO_BOX_PX

/**
 * Preferred height for one inner-artefact row (title rail / superslim heuristic). Mirrors
 * {@link PackageInnerDiagram}’s vertical-title sizing so compression shares one source of truth.
 */
export function innerArtefactSlotPreferredHeightPx(label: string | undefined): number {
  const titleLength = Math.max(1, (label ?? '').trim().length)
  return Math.max(132, Math.min(280, 76 + titleLength * 9))
}
