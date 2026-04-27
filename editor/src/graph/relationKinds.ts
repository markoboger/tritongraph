/** sbt-style `dependsOn` / library dependency edges (classpath ordering for layout). */
export const SBT_DEPENDS_ON_STROKE = '#2563eb'

/** Inner-package inheritance edge: class / primary parent (`extends`). */
export const SCALA_EXTENDS_STROKE = '#1d4ed8'

/** Inner-package mixin parent (`with` in Scala → shown as “has trait” in the UI). */
export const SCALA_HAS_TRAIT_STROKE = '#9333ea'

/** TypeScript `implements` relation: class implements interface. */
export const TS_IMPLEMENTS_STROKE = '#7c3aed'

/**
 * Inner-package "gets" relation: artefact A takes artefact B as a primary-constructor
 * parameter (directly or through a generic wrapper). Amber tone so it reads as a structural
 * reference distinct from inheritance (`extends` blue, `with` purple).
 */
export const SCALA_GETS_STROKE = '#d97706'

/** Inner-package "creates" relation: artefact A constructs artefact B in its body. */
export const SCALA_CREATES_STROKE = '#059669'

/** TypeScript "returns" relation: function/method returns a type. */
export const TS_RETURNS_STROKE = '#0ea5e9'

/** TypeScript "imports" relation: file/module imports a type/value from another package. */
export const TS_IMPORTS_STROKE = '#f59e0b'

/** sbt `aggregate(...)` — task scope / project grouping; also contributes to depth columns. */
export const SBT_AGGREGATE_STROKE = '#16a34a'

export function isAggregateEdge(e: { label?: unknown }): boolean {
  const t = String(e.label ?? '').trim().toLowerCase()
  return t === 'aggregate' || t === 'aggregates' || t === 'contains'
}

/**
 * Relations that participate in LR depth columns and share one routing strategy: parallel
 * source-handle fan-out (`agg-out-*`), target `agg-in`, and top/bottom lane smoothsteps when
 * skipping columns or fanning parallels (same pipeline as sbt `aggregate(...)` edges).
 *
 * Any non-empty `label` is included so new Ilograph relation types behave the same without
 * extra registration.
 */
export function edgeContributesToClasspathDepth(e: { label?: unknown }): boolean {
  return String(e.label ?? '').trim().length > 0
}

export function strokeForIlographRelation(rel: { label?: unknown; color?: unknown }): string {
  const c = rel.color
  if (c != null && String(c).trim()) return String(c)
  return isAggregateEdge(rel) ? SBT_AGGREGATE_STROKE : SBT_DEPENDS_ON_STROKE
}

/** Stroke for a Vue Flow edge (`style.stroke` when set, else derived from `label`). */
export function strokeColorForFlowEdge(e: { label?: unknown; style?: unknown }): string {
  const st = e.style
  if (st && typeof st === 'object') {
    const stroke = (st as { stroke?: unknown }).stroke
    if (typeof stroke === 'string' && stroke.trim()) return stroke.trim()
  }
  return strokeForIlographRelation({ label: e.label })
}
