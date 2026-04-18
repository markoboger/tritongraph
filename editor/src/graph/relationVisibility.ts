/** Canonical key for grouping / filtering edges by Ilograph relation `label`. */
export function normalizeRelationTypeKey(label: unknown): string {
  const s = String(label ?? '').trim()
  return s.length ? s : '(no label)'
}

export function shouldHideEdgeForRelationFilter(
  e: { label?: unknown },
  visibility: Readonly<Record<string, boolean>> | undefined,
): boolean {
  if (!visibility) return false
  return visibility[normalizeRelationTypeKey(e.label)] === false
}

/** Stable signature of relation labels present on edges (for syncing filter UI). */
export function relationTypeKeysSignature(edges: readonly { label?: unknown }[]): string {
  return [...new Set(edges.map((e) => normalizeRelationTypeKey(e.label)))].sort().join('\n')
}

export function relationTypesFromSignature(sig: string): string[] {
  return sig.length ? sig.split('\n') : []
}
