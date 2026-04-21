import { Position } from '@vue-flow/core'
import type {
  IlographDocument,
  IlographResource,
  TritonInnerArtefactRelationSpec,
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
  const declaration =
    typeof o.declaration === 'string' && o.declaration.trim() ? String(o.declaration) : undefined
  const constructorParams =
    typeof o.constructorParams === 'string' && o.constructorParams.trim()
      ? String(o.constructorParams)
      : undefined
  const methodSignatures = normalizeMethodSignatureArray(o.methodSignatures)
  const sourceFile =
    typeof o.sourceFile === 'string' && o.sourceFile.trim() ? String(o.sourceFile) : undefined
  const sourceRow =
    typeof o.sourceRow === 'number' && Number.isFinite(o.sourceRow) ? (o.sourceRow as number) : undefined
  return {
    id: o.id,
    name,
    ...(subtitle ? { subtitle } : {}),
    ...(declaration ? { declaration } : {}),
    ...(constructorParams ? { constructorParams } : {}),
    ...(methodSignatures.length ? { methodSignatures } : {}),
    ...(sourceFile ? { sourceFile } : {}),
    ...(sourceRow !== undefined ? { sourceRow } : {}),
  }
}

/**
 * Normalise `methodSignatures` entries to the rich shape `{ signature, startRow }`. The
 * canonical scanner output already emits objects; strings are accepted as a backwards-compat
 * fallback for hand-edited YAML (no row information → row `0`, which degrades the click-to-open
 * action to "open the file at the top" rather than failing silently). Anything else is dropped.
 */
function normalizeMethodSignatureArray(
  raw: unknown,
): Array<{ signature: string; startRow: number }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ signature: string; startRow: number }> = []
  for (const v of raw) {
    if (typeof v === 'string' && v.trim().length > 0) {
      out.push({ signature: v, startRow: 0 })
      continue
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const sig = typeof o.signature === 'string' ? o.signature : ''
      if (!sig.trim()) continue
      const row =
        typeof o.startRow === 'number' && Number.isFinite(o.startRow) ? (o.startRow as number) : 0
      out.push({ signature: sig, startRow: row })
    }
  }
  return out
}

function normalizeInnerArtefactRelationSpec(raw: unknown): TritonInnerArtefactRelationSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.from !== 'string' || !o.from) return null
  if (typeof o.to !== 'string' || !o.to) return null
  /** Unknown labels fall back to `extends` so a hand-edited YAML with a typo still renders. */
  const label: TritonInnerArtefactRelationSpec['label'] =
    o.label === 'with' ? 'with' : o.label === 'gets' ? 'gets' : 'extends'
  const wrapperName = typeof o.wrapperName === 'string' ? o.wrapperName : undefined
  return { from: o.from, to: o.to, label, ...(wrapperName ? { wrapperName } : {}) }
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
    const innerRelsRaw = res['x-triton-inner-artefact-relations']
    const innerArtefactRelations =
      Array.isArray(innerRelsRaw) && innerRelsRaw.length
        ? innerRelsRaw
            .map(normalizeInnerArtefactRelationSpec)
            .filter((x): x is TritonInnerArtefactRelationSpec => x !== null)
        : undefined
    const crossRelsRaw = res['x-triton-cross-artefact-relations']
    const crossArtefactRelations =
      Array.isArray(crossRelsRaw) && crossRelsRaw.length
        ? crossRelsRaw
            .map(normalizeInnerArtefactRelationSpec)
            .filter((x): x is TritonInnerArtefactRelationSpec => x !== null)
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
        ...(typeof res['x-triton-declaration'] === 'string' && res['x-triton-declaration'].trim()
          ? { declaration: String(res['x-triton-declaration']) }
          : {}),
        ...(typeof res['x-triton-constructor-params'] === 'string' &&
        res['x-triton-constructor-params'].trim()
          ? { constructorParams: String(res['x-triton-constructor-params']) }
          : {}),
        ...(() => {
          const sigs = normalizeMethodSignatureArray(res['x-triton-method-signatures'])
          return sigs.length ? { methodSignatures: sigs } : {}
        })(),
        ...(typeof res['x-triton-source-file'] === 'string' && res['x-triton-source-file'].trim()
          ? { sourceFile: String(res['x-triton-source-file']) }
          : {}),
        ...(typeof res['x-triton-source-row'] === 'number' && Number.isFinite(res['x-triton-source-row'])
          ? { sourceRow: res['x-triton-source-row'] as number }
          : {}),
        ...(boxColor ? { boxColor } : {}),
        ...(!isGroup && pinnedIds.has(id) ? { pinned: true } : {}),
        ...(!isGroup ? { language: languageIconForId(id), drillNote: drillNoteForModuleId(id) } : {}),
        ...(innerPackages?.length ? { innerPackages } : {}),
        ...(innerArtefacts?.length ? { innerArtefacts } : {}),
        ...(innerArtefactRelations?.length ? { innerArtefactRelations } : {}),
        ...(crossArtefactRelations?.length ? { crossArtefactRelations } : {}),
        ...(isGroup && res['x-triton-package-scope'] === true ? { packageScope: true } : {}),
        ...(isGroup && res['x-triton-package-scope'] === true && typeof res['x-triton-package-language'] === 'string'
          ? { language: res['x-triton-package-language'] }
          : {}),
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
