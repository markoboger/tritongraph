/**
 * Column layers for inner-package artefact diagrams: parents left → children right
 * (same convention as {@link ScalaInheritanceEdge}: from parent id to child id).
 */

export type InnerArtefactEdge = { from: string; to: string }

/**
 * Longest-path layering on a DAG fragment. Bounded relaxation so cycles (invalid Scala but
 * possible in hand-edited YAML) do not spin.
 *
 * Empty intermediate layers are **compacted** before returning: when back-edges (e.g. an
 * `imports` relation pointing earlier in a chain) inflate layer indices via the bounded
 * relaxation loop, the result would otherwise contain large holes (e.g. layer 0 occupied,
 * layers 1–9 empty, layer 10 occupied). Those empty layers would render as full flex-grow
 * columns in {@link PackageInnerDiagram}, blowing the visible inner gap up by 5–10× per hole.
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
  const sparseLayers: string[][] = Array.from({ length: maxL + 1 }, () => [])
  for (const id of sortedIds) {
    const L = layerOf.get(id) ?? 0
    sparseLayers[L]!.push(id)
  }
  /** Drop empty buckets so consumer columns reflect the **occupied** depth, not bounded-relaxation noise. */
  return sparseLayers.filter((layer) => layer.length > 0)
}
