import { Position } from '@vue-flow/core'
import type {
  IlographDocument,
  IlographResource,
  TritonInnerArtefactSpec,
  TritonInnerPackageSpec,
} from '../ilograph/types'
import { resourceKey, splitRefs } from '../ilograph/refs'
import { boxColorForId, isNamedBoxColor } from './boxColors'
import { languageIconForId } from './languages'
import { dependencyEdgeLabelStyle, dependencyEdgeStyle, markersForAggregateEdge, markersForRelation } from './edgeTheme'
import { isAggregateEdge, strokeForIlographRelation } from './relationKinds'
import { AGG_SOURCE_HANDLE, AGG_TARGET_HANDLE } from './handles'
import { drillNoteForModuleId } from './sbtStyleDrillNotes'

const DEP_PERSPECTIVE_NAMES = new Set(['dependencies', 'module dependencies', 'depends on'])

export interface FlowFromIlographOptions {
  /** When true, use x-triton-editor.positions if present */
  preferSavedPositions?: boolean
  /**
   * Vue Flow `type` for non-group resource nodes. Picks which custom node component renders the box
   * (e.g. `module` → `FlowProjectNode`, `package` → `FlowPackageNode`). Defaults to `module`.
   * Group resources always render as `group` regardless of this option.
   */
  moduleNodeType?: string
}

function flattenResources(
  list: IlographResource[] | undefined,
  parentId: string | undefined,
  out: { res: IlographResource; parentId: string | undefined }[],
): void {
  if (!list) return
  for (const res of list) {
    out.push({ res, parentId })
    if (res.children?.length) {
      flattenResources(res.children, resourceKey(res), out)
    }
  }
}

function pickDependencyPerspective(doc: IlographDocument) {
  const perspectives = doc.perspectives ?? []
  const named = perspectives.find(
    (p) => DEP_PERSPECTIVE_NAMES.has(p.name.trim().toLowerCase()) && p.relations?.length,
  )
  if (named) return named
  return perspectives.find((p) => p.relations?.length) ?? perspectives[0]
}

function defaultPosition(index: number): { x: number; y: number } {
  const col = index % 4
  const row = Math.floor(index / 4)
  return { x: col * 220 + 40, y: row * 120 + 40 }
}

function normalizeInnerPackageSpec(raw: unknown): TritonInnerPackageSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  const name = typeof o.name === 'string' && o.name ? o.name : o.id
  const subtitle =
    typeof o.subtitle === 'string' && o.subtitle.trim() ? String(o.subtitle) : undefined
  const nestedRaw = o.innerPackages
  const innerNested =
    Array.isArray(nestedRaw) && nestedRaw.length
      ? nestedRaw
          .map(normalizeInnerPackageSpec)
          .filter((x): x is TritonInnerPackageSpec => x !== null)
      : []
  return {
    id: o.id,
    name,
    ...(subtitle ? { subtitle } : {}),
    ...(innerNested.length ? { innerPackages: innerNested } : {}),
  }
}

function normalizeInnerArtefactSpec(raw: unknown): TritonInnerArtefactSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  const name = typeof o.name === 'string' && o.name ? o.name : o.id
  const subtitle =
    typeof o.subtitle === 'string' && o.subtitle.trim() ? String(o.subtitle) : undefined
  return {
    id: o.id,
    name,
    ...(subtitle ? { subtitle } : {}),
  }
}

export function ilographDocumentToFlow(
  doc: IlographDocument,
  options: FlowFromIlographOptions = {},
): { nodes: any[]; edges: any[]; perspectiveName: string | undefined } {
  const flat: { res: IlographResource; parentId: string | undefined }[] = []
  flattenResources(doc.resources, undefined, flat)

  const editor = doc['x-triton-editor']
  const saved = options.preferSavedPositions ? editor?.positions : undefined
  /** Always apply saved palette when valid (independent of whether positions are applied). */
  const savedColors = editor?.moduleColors
  const pinnedIds = new Set(editor?.pinnedModuleIds ?? [])

  const moduleType = options.moduleNodeType ?? 'module'
  const nodes: any[] = flat.map(({ res, parentId }, i) => {
    const id = resourceKey(res)
    const pos = saved?.[id] ?? defaultPosition(i)
    const isGroup = flat.some((x) => x.parentId === id)
    const persisted = savedColors?.[id]
    const boxColor = !isGroup && isNamedBoxColor(persisted) ? persisted : !isGroup ? boxColorForId(id) : undefined
    /**
     * Per-resource override (`x-triton-node-type`) wins over the document-level default. Lets one
     * generated document mix node kinds (package containers + artefact leaves) without splitting
     * the conversion pipeline. Containers always render as `group` regardless of the override:
     * a custom-typed container would lose the GroupNode banner / nested layout, and we don't yet
     * have a custom group component to replace it with.
     */
    const overrideType = typeof res['x-triton-node-type'] === 'string' ? res['x-triton-node-type'] : undefined
    const leafType = overrideType ?? moduleType
    const innerPkgs = res['x-triton-inner-packages']
    const innerPackages =
      Array.isArray(innerPkgs) && innerPkgs.length
        ? innerPkgs.map(normalizeInnerPackageSpec).filter((x): x is TritonInnerPackageSpec => x !== null)
        : undefined
    const innerArtsRaw = res['x-triton-inner-artefacts']
    const innerArtefacts =
      Array.isArray(innerArtsRaw) && innerArtsRaw.length
        ? innerArtsRaw.map(normalizeInnerArtefactSpec).filter((x): x is TritonInnerArtefactSpec => x !== null)
        : undefined
    return {
      id,
      type: isGroup ? 'group' : leafType,
      position: pos,
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      data: {
        label: res.name,
        subtitle: res.subtitle ?? '',
        description: typeof res.description === 'string' ? res.description : '',
        ...(boxColor ? { boxColor } : {}),
        ...(!isGroup && pinnedIds.has(id) ? { pinned: true } : {}),
        ...(!isGroup ? { language: languageIconForId(id), drillNote: drillNoteForModuleId(id) } : {}),
        ...(innerPackages?.length ? { innerPackages } : {}),
        ...(innerArtefacts?.length ? { innerArtefacts } : {}),
        ...(isGroup && res['x-triton-package-scope'] === true ? { packageScope: true } : {}),
      },
      parentNode: parentId,
      style: isGroup
        ? { width: 520, height: 360, backgroundColor: 'rgba(240,248,255,0.35)' }
        : undefined,
      extent: parentId ? ('parent' as const) : undefined,
      expandParent: !!parentId,
    }
  })

  const perspective = pickDependencyPerspective(doc)
  const edges: any[] = []
  let e = 0
  if (perspective?.relations) {
    for (const rel of perspective.relations) {
      const froms = splitRefs(rel.from)
      const tos = splitRefs(rel.to)
      if (!froms.length || !tos.length) continue
      for (const f of froms) {
        for (const t of tos) {
          const id = `e-${e++}`
          const bidirectional = rel.arrowDirection === 'bidirectional'
          const stroke = strokeForIlographRelation(rel)
          const aggregate = isAggregateEdge(rel)
          const markers = aggregate
            ? markersForAggregateEdge(stroke)
            : markersForRelation(bidirectional, stroke)
          edges.push({
            id,
            source: f,
            target: t,
            sourceHandle: AGG_SOURCE_HANDLE,
            targetHandle: AGG_TARGET_HANDLE,
            label: rel.label ?? 'depends on',
            labelStyle: dependencyEdgeLabelStyle(),
            ...markers,
            style: dependencyEdgeStyle(stroke),
          })
        }
      }
    }
  }

  return { nodes, edges, perspectiveName: perspective?.name }
}
