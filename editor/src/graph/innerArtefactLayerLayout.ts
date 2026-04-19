/**
 * Column layers for inner-package artefact diagrams: parents left → children right
 * (same convention as {@link ScalaInheritanceEdge}: from parent id to child id).
 */

export type InnerArtefactEdge = { from: string; to: string }

/**
 * Longest-path layering on a DAG fragment. Bounded relaxation so cycles (invalid Scala but
 * possible in hand-edited YAML) do not spin.
 */
export function assignInnerArtefactLayers(
  artefactIds: readonly string[],
  edges: readonly InnerArtefactEdge[],
): string[][] {
  const sortedIds = [...artefactIds].sort()
  if (!sortedIds.length) return []
  const idSet = new Set(sortedIds)
  const incoming = new Map<string, string[]>()
  for (const id of sortedIds) incoming.set(id, [])
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue
    incoming.get(e.to)!.push(e.from)
  }
  const layerOf = new Map<string, number>()
  for (const id of sortedIds) layerOf.set(id, 0)
  const maxIt = sortedIds.length + 2
  for (let it = 0; it < maxIt; it++) {
    let changed = false
    for (const id of sortedIds) {
      const preds = incoming.get(id) ?? []
      const nextLayer = preds.length === 0 ? 0 : Math.max(...preds.map((p) => layerOf.get(p) ?? 0)) + 1
      const prev = layerOf.get(id) ?? 0
      if (nextLayer > prev) {
        layerOf.set(id, nextLayer)
        changed = true
      }
    }
    if (!changed) break
  }
  const maxL = Math.max(0, ...sortedIds.map((id) => layerOf.get(id) ?? 0))
  const layers: string[][] = Array.from({ length: maxL + 1 }, () => [])
  for (const id of sortedIds) {
    const L = layerOf.get(id) ?? 0
    layers[L]!.push(id)
  }
  return layers
}
