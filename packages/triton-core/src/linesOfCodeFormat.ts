/** Human-readable lines-of-code (`loc` / `kloc`) for diagram subtitles. */
export function formatLinesOfCodeUnit(lines: number): string {
  const n = Math.max(0, Math.round(lines))
  if (n === 0) return '0 loc'
  if (n < 1000) return `${n} loc`
  const k = n / 1000
  const s = k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')
  return `${s} kloc`
}
