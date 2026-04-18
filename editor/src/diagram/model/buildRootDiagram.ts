import { dependencyDepthsInRegion } from '../../graph/layoutDependencyLayers'
import type {
  BoxId,
  DiagramContainer,
  DiagramLayerModel,
  DiagramRootModel,
  DiagramSectionModel,
  ProjectBoxModel,
} from './types'

type FlowNode = {
  id: string
  type?: string
  parentNode?: string
  data?: Record<string, unknown>
}

type FlowEdge = { source: string; target: string; label?: unknown }

function readProjectBox(flowId: BoxId, data: Record<string, unknown> | undefined): ProjectBoxModel {
  const d = data ?? {}
  return {
    kind: 'project',
    id: flowId,
    label: String(d.label ?? ''),
    subtitle: d.subtitle != null ? String(d.subtitle) : undefined,
    notes: d.drillNote != null ? String(d.drillNote) : undefined,
    language: d.language != null ? String(d.language) : undefined,
    accentColor: d.boxColor != null ? String(d.boxColor) : undefined,
    pinned: d.pinned === true,
    focused: d.layerDrillFocus === true,
  }
}

/**
 * Build the root {@link DiagramContainer} from the current Vue Flow graph (root-level modules only).
 * Nested group containers are not expanded yet — modules inside groups still appear in their parent’s flow space.
 */
export function buildRootDiagramContainer(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  bounds: { x: number; y: number; width: number; height: number },
): DiagramContainer {
  const rootModules = nodes.filter((n) => n.type === 'module' && !n.parentNode)
  const depths = dependencyDepthsInRegion(nodes as any, edges, undefined)
  const maxD = depths.size ? Math.max(0, ...depths.values()) : 0

  const byDepth = new Map<number, FlowNode[]>()
  for (let d = 0; d <= maxD; d++) byDepth.set(d, [])
  for (const n of rootModules) {
    const d = Math.min(maxD, Math.max(0, depths.get(n.id) ?? 0))
    byDepth.get(d)!.push(n)
  }
  for (const arr of byDepth.values()) {
    arr.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }

  const layerDrillFocusId =
    rootModules.find((n) => (n.data as Record<string, unknown> | undefined)?.layerDrillFocus === true)?.id ??
    null

  const layers: DiagramLayerModel[] = []
  for (let depth = 0; depth <= maxD; depth++) {
    const row = byDepth.get(depth) ?? []
    const sections: DiagramSectionModel[] = row.map((n, indexInLayer) => {
      const data = n.data as Record<string, unknown> | undefined
      const box = readProjectBox(n.id, data)
      return {
        id: `section:${n.id}`,
        layerDepth: depth,
        indexInLayer,
        graphNodeId: n.id,
        box,
      }
    })
    const pinnedSectionIds = sections.filter((s) => s.box.pinned).map((s) => s.id)
    const focusedSection =
      layerDrillFocusId != null ? sections.find((s) => s.graphNodeId === layerDrillFocusId) : undefined
    layers.push({
      depth,
      sections,
      pinnedSectionIds,
      focusedSectionId: focusedSection?.id ?? null,
    })
  }

  return {
    id: 'root',
    parentContainerId: undefined,
    bounds: { ...bounds },
    layers,
  }
}

export function buildDiagramRootModel(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  bounds: { x: number; y: number; width: number; height: number },
): DiagramRootModel {
  const container = buildRootDiagramContainer(nodes, edges, bounds)
  const projectGraphNodeIds = nodes.filter((n) => n.type === 'module').map((n) => n.id)
  return { container, projectGraphNodeIds }
}
