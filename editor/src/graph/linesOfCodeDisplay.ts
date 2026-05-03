/**
 * Human-readable lines-of-code units for diagram chrome (`loc` below 1k, `kloc` otherwise).
 * Canonical formatter lives in `triton-core` so sbt ilograph subtitles stay consistent.
 */
import { formatLinesOfCodeUnit as formatLocUnit } from '../../../packages/triton-core/src/linesOfCodeFormat.ts'

export { formatLinesOfCodeUnit } from '../../../packages/triton-core/src/linesOfCodeFormat.ts'

/**
 * Strip a trailing `, N loc` / `, N.N kloc` suffix from inner-artefact / leaf subtitles.
 * Node-type filters, visibility keys, and kind icons must use the bare Scala kind (or TS kind),
 * not the display suffix added for LOC chrome.
 */
export function artefactSubtitleSansMetrics(subtitle: string | undefined): string {
  return String(subtitle ?? '')
    .trim()
    .replace(/,\s*[\d.]+\s+(?:kloc|loc)\s*$/i, '')
    .trim()
}

/** Trailing `, N loc` / `, N kloc` segment only (empty when absent). For appending to declaration headers. */
export function metricsSuffixFromArtefactSubtitle(subtitle: string | undefined): string {
  const raw = String(subtitle ?? '').trim()
  const sans = artefactSubtitleSansMetrics(raw)
  if (sans.length >= raw.length) return ''
  return raw.slice(sans.length).trim()
}

/** Inclusive physical line span from 0-indexed tree-sitter rows. */
export function physicalLineSpanInclusive(startRow: number, endRow: number): number {
  if (!Number.isFinite(startRow) || !Number.isFinite(endRow)) return 0
  if (endRow < startRow) return 0
  return endRow - startRow + 1
}

function locSuffixFromRows(sourceRow: number | undefined, sourceEndRow: number | undefined): string {
  if (
    typeof sourceRow !== 'number' ||
    !Number.isFinite(sourceRow) ||
    typeof sourceEndRow !== 'number' ||
    !Number.isFinite(sourceEndRow)
  ) {
    return ''
  }
  const span = physicalLineSpanInclusive(sourceRow, sourceEndRow)
  return span > 0 ? `, ${formatLocUnit(span)}` : ''
}

/**
 * Compact inner-artefact row text: prefer declaration, but append `, N loc` from `subtitle` or
 * `sourceRow`/`sourceEndRow` when the row would otherwise drop the metrics tail.
 */
export function innerArtefactRowSubtitle(cell: {
  declaration?: string
  subtitle?: string
  sourceRow?: number
  sourceEndRow?: number
}): string {
  const decl = String(cell.declaration ?? '').trim()
  const sub = String(cell.subtitle ?? '').trim()
  const suffix = metricsSuffixFromArtefactSubtitle(sub) || locSuffixFromRows(cell.sourceRow, cell.sourceEndRow)
  if (decl) {
    if (!suffix) return decl
    return metricsSuffixFromArtefactSubtitle(decl) ? decl : `${decl}${suffix}`
  }
  return sub
}

export function sumPhysicalLinesForPaths(
  paths: readonly string[],
  fileLineCounts: Readonly<Record<string, number>> | undefined,
): number {
  if (!fileLineCounts || !paths.length) return 0
  let t = 0
  for (const p of paths) t += fileLineCounts[p] ?? 0
  return t
}

const TEST_SRC_RE = /(?:^|\/)src\/test\//i

function countPhysicalSourceLines(source: string): number {
  if (source === '') return 0
  return source.split(/\r\n|\n|\r/).length
}

/**
 * Sum physical lines across bundled `.scala` files, excluding `src/test/` paths (same scope as the
 * Scala package graph’s file totals).
 */
export function totalMainScalaPhysicalLines(
  files: ReadonlyArray<{ relPath: string; source: string }>,
): number {
  let t = 0
  for (const f of files) {
    if (TEST_SRC_RE.test(f.relPath)) continue
    t += countPhysicalSourceLines(f.source ?? '')
  }
  return t
}
