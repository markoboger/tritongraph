function normalizeSbtBaseDir(p: { id: string; baseDir?: string }): string {
  return (p.baseDir ?? p.id).replace(/^\/+|\/+$/g, '')
}

function countPhysicalSourceLines(source: string): number {
  if (source === '') return 0
  return source.split(/\r\n|\n|\r/).length
}

/**
 * Longest matching `baseDir` prefix wins; files under no subdir map to the first `.` / empty
 * baseDir project (aggregate root), matching {@link computeProjectsWithScalaSourceFiles}.
 */
export function owningSbtProjectIdForFile(
  relPath: string,
  projects: readonly { id: string; baseDir?: string }[],
): string | null {
  let best: { id: string; prefixLen: number } | null = null
  for (const p of projects) {
    const rawDir = normalizeSbtBaseDir(p)
    if (rawDir === '' || rawDir === '.') continue
    const slashPrefix = `${rawDir}/`
    if (relPath === rawDir || relPath.startsWith(slashPrefix)) {
      if (!best || rawDir.length > best.prefixLen) best = { id: p.id, prefixLen: rawDir.length }
    }
  }
  if (best) return best.id
  for (const p of projects) {
    const rawDir = normalizeSbtBaseDir(p)
    if (rawDir === '' || rawDir === '.') return p.id
  }
  return null
}

/** Sum physical lines of `.scala` sources per sbt project id (see {@link owningSbtProjectIdForFile}). */
export function computeSbtProjectScalaLineCounts(
  files: ReadonlyArray<{ relPath: string; source: string }>,
  projects: ReadonlyArray<{ id: string; baseDir?: string }>,
): Record<string, number> {
  const totals = new Map<string, number>()
  for (const f of files) {
    const owner = owningSbtProjectIdForFile(f.relPath, projects)
    if (!owner) continue
    totals.set(owner, (totals.get(owner) ?? 0) + countPhysicalSourceLines(f.source ?? ''))
  }
  const out: Record<string, number> = {}
  for (const [id, n] of totals) {
    if (n > 0) out[id] = n
  }
  return out
}
