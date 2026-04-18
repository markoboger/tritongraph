import { AGG_SOURCE_HANDLE } from './handles'
import { edgeContributesToClasspathDepth } from './relationKinds'

export type UsedFlowHandles = {
  /** Sorted unique aggregate source slots (`agg-out-N`) in use for this node as source; always includes 0 for Strict connect. */
  aggOutSlots: number[]
}

function edgeVisible(e: { hidden?: boolean }): boolean {
  return !(e as { hidden?: boolean }).hidden
}

function parseAggOutSlot(sourceHandle: unknown): number {
  const sh = String(sourceHandle ?? AGG_SOURCE_HANDLE)
  const m = sh.match(/^agg-out-(\d+)$/)
  if (m) return Number(m[1])
  if (sh === 'agg-out') return 0
  return 0
}

/**
 * Which connection handles on a module/group should be rendered, derived from current edges.
 * All labeled depth relations use `agg-out-*` / `agg-in` (same strategy as sbt aggregates).
 */
export function usedHandlesForNode(
  nodeId: string,
  edges: readonly {
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
    label?: unknown
    hidden?: boolean
  }[],
): UsedFlowHandles {
  const aggOut = new Set<number>([0])

  for (const e of edges) {
    if (!edgeVisible(e)) continue
    if (!edgeContributesToClasspathDepth(e)) continue
    if (String(e.source) === nodeId) {
      aggOut.add(parseAggOutSlot(e.sourceHandle))
    }
  }

  return {
    aggOutSlots: [...aggOut].sort((a, b) => a - b),
  }
}
