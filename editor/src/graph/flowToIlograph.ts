import type { IlographDocument, IlographPerspective, IlographResource } from '../ilograph/types'
import type { ExportFlowEdge, ExportFlowNode } from './flowExportModel'
import { isNamedBoxColor } from './boxColors'
import { isLeafBoxNode } from './nodeKinds'

function exportResourceName(n: ExportFlowNode): string {
  return String(n.data?.label ?? n.id)
}

function buildResourceTree(nodes: ExportFlowNode[]): IlographResource[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string | undefined, ExportFlowNode[]>()
  for (const n of nodes) {
    const p = n.parentNode as string | undefined
    const list = children.get(p) ?? []
    list.push(n)
    children.set(p, list)
  }

  function subtree(parentId: string | undefined): IlographResource[] {
    const list = children.get(parentId) ?? []
    const resources: IlographResource[] = []
    for (const n of list) {
      if (n.type === 'group') {
        const res: IlographResource = {
          name: exportResourceName(n),
          subtitle: String(n.data?.subtitle ?? ''),
        }
        if (n.data?.description) res.description = String(n.data.description)
        const nested = subtree(n.id)
        if (nested.length) res.children = nested
        resources.push(res)
        continue
      }
      if (!isLeafBoxNode(n)) continue
      const res: IlographResource = {
        id: n.id,
        name: exportResourceName(n),
        subtitle: String(n.data?.subtitle ?? ''),
      }
      if (n.data?.description) res.description = String(n.data.description)
      const ip = (n.data as Record<string, unknown> | undefined)?.innerPackages
      if (Array.isArray(ip) && ip.length) {
        res['x-triton-inner-packages'] = ip as NonNullable<IlographResource['x-triton-inner-packages']>
      }
      const ia = (n.data as Record<string, unknown> | undefined)?.innerArtefacts
      if (Array.isArray(ia) && ia.length) {
        res['x-triton-inner-artefacts'] = ia as NonNullable<IlographResource['x-triton-inner-artefacts']>
      }
      const iar = (n.data as Record<string, unknown> | undefined)?.innerArtefactRelations
      if (Array.isArray(iar) && iar.length) {
        res['x-triton-inner-artefact-relations'] = iar as NonNullable<
          IlographResource['x-triton-inner-artefact-relations']
        >
      }
      const nested = subtree(n.id)
      if (nested.length) res.children = nested
      resources.push(res)
    }
    return resources
  }

  const roots = subtree(undefined)
  const orphanIds = new Set(
    nodes.filter((n) => n.parentNode && !byId.has(String(n.parentNode))).map((n) => n.id),
  )
  if (!orphanIds.size) return roots

  const patched: IlographResource[] = [...roots]
  for (const n of nodes) {
    if (!orphanIds.has(n.id)) continue
    patched.push({
      name: exportResourceName(n),
      subtitle: String(n.data?.subtitle ?? ''),
      ...(n.data?.description ? { description: String(n.data.description) } : {}),
    })
  }
  return patched
}

function relationsFromEdges(
  edges: ExportFlowEdge[],
  idToExportedName: Map<string, string>,
): IlographDocument['perspectives'] {
  const relations = edges.map((e) => ({
    from: idToExportedName.get(e.source) ?? e.source,
    to: idToExportedName.get(e.target) ?? e.target,
    label: typeof e.label === 'string' && e.label ? e.label : 'depends on',
    arrowDirection:
      e.markerStart && e.markerEnd ? ('bidirectional' as const) : ('forward' as const),
  }))
  const perspective: IlographPerspective = {
    name: 'dependencies',
    orientation: 'leftToRight',
    color: 'royalblue',
    notes:
      'depends on = classpath (dependsOn); aggregate = sbt aggregate(...) (both contribute to depth columns).',
    relations,
  }
  return [perspective]
}

export function flowToIlographDocument(
  nodes: ExportFlowNode[],
  edges: ExportFlowEdge[],
  meta: { description?: string; perspectiveName?: string } = {},
): IlographDocument {
  const resources = buildResourceTree(nodes)
  const idToExportedName = new Map(nodes.map((n) => [n.id, exportResourceName(n)]))
  const perspectives = relationsFromEdges(edges, idToExportedName)
  if (meta.perspectiveName) {
    perspectives![0]!.name = meta.perspectiveName
  }

  const positions: Record<string, { x: number; y: number }> = {}
  const moduleColors: Record<string, string> = {}
  const pinnedModuleIds: string[] = []
  for (const n of nodes) {
    positions[n.id] = { ...n.position }
    if (isLeafBoxNode(n)) {
      const c = n.data?.boxColor
      if (isNamedBoxColor(c)) moduleColors[n.id] = c
      if (n.data?.pinned === true) pinnedModuleIds.push(n.id)
    }
  }

  return {
    description:
      meta.description ??
      'Sbt-style modules (resources) and compile dependencies (perspective relations). Compatible with Ilograph: https://ilograph.com/docs/spec',
    resources,
    perspectives,
    'x-triton-editor': {
      positions,
      ...(Object.keys(moduleColors).length ? { moduleColors } : {}),
      ...(pinnedModuleIds.length ? { pinnedModuleIds } : {}),
    },
  }
}
