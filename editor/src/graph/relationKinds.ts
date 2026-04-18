/** sbt-style `dependsOn` / library dependency edges (classpath ordering for layout). */
export const SBT_DEPENDS_ON_STROKE = '#2563eb'

/** sbt `aggregate(...)` — task scope / project grouping; also contributes to depth columns. */
export const SBT_AGGREGATE_STROKE = '#16a34a'

export function isAggregateEdge(e: { label?: unknown }): boolean {
  const t = String(e.label ?? '').trim().toLowerCase()
  return t === 'aggregate' || t === 'aggregates'
}

/** Column depth (“layering”) uses both classpath (`depends on`) and aggregate edges (YAML `from` → `to` = left → right). */
export function edgeContributesToClasspathDepth(e: { label?: unknown }): boolean {
  const t = String(e.label ?? '').trim().toLowerCase()
  if (!t) return false
  return t === 'depends on' || isAggregateEdge(e)
}

export function strokeForIlographRelation(rel: { label?: unknown; color?: unknown }): string {
  const c = rel.color
  if (c != null && String(c).trim()) return String(c)
  return isAggregateEdge(rel) ? SBT_AGGREGATE_STROKE : SBT_DEPENDS_ON_STROKE
}
