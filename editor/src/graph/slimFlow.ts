import type { ExportFlowEdge, ExportFlowNode } from './flowExportModel'

/** `any` avoids Vue Flow `Node` / `Edge` generics exploding under vue-tsc. */
export function slimNodesForExport(nodes: readonly any[]): ExportFlowNode[] {
  return nodes.map((n) => {
    const raw = n.data as Record<string, unknown> | undefined
    let data = raw
    if (raw && typeof raw === 'object') {
      const { layerDrillFocus: _lf, drillNote: _dn, layerFlip: _flip, anchorTops: _at, ...rest } = raw
      data = rest as Record<string, unknown>
    }
    return {
      id: String(n.id),
      type: n.type as string | undefined,
      position: { x: Number(n.position?.x ?? 0), y: Number(n.position?.y ?? 0) },
      data,
      parentNode: typeof n.parentNode === 'string' ? n.parentNode : undefined,
      style: n.style as Record<string, unknown> | undefined,
    }
  })
}

export function slimEdgesForExport(edges: readonly any[]): ExportFlowEdge[] {
  return edges.map((e) => ({
    id: String(e.id),
    source: String(e.source),
    target: String(e.target),
    label: typeof e.label === 'string' ? e.label : undefined,
    markerStart: e.markerStart,
    markerEnd: e.markerEnd,
  }))
}
