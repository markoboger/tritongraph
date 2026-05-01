import type {
  IlographDocument,
  IlographPerspective,
  IlographResource,
  TritonInnerArtefactSpec,
} from '../ilograph/types'
import type { ExportFlowEdge, ExportFlowNode } from './flowExportModel'
import { isLeafBoxNode } from './nodeKinds'

function exportResourceName(n: ExportFlowNode): string {
  return String(n.data?.label ?? n.id)
}

/**
 * Strip scanner-only fields (`declaration`, `constructorParams`, `methodSignatures`,
 * `sourceFile`, `sourceRow`) from an inner-artefact entry before emitting it to YAML.
 *
 * These fields are derived freshly from Scala source on every scan:
 *   - `declaration` / `constructorParams` / `methodSignatures` change every time a signature
 *     is edited and bloat the YAML with prose that's already in the source file.
 *   - `sourceFile` / `sourceRow` are location hints for the open-in-editor handoff; they
 *     drift on every refactor (add an import → every row below moves) and produce massive
 *     noisy diffs that have nothing to do with the graph structure.
 *
 * Keeping only `id` / `name` / `subtitle` (the Scala kind keyword: `class`, `trait`, …)
 * means a YAML diff between two scans highlights real graph changes — artefacts added,
 * removed, renamed, or changing kind — instead of every line-number shift. Runtime UI
 * features (focused method list, Arguments panel, open-in-editor) still work on the live
 * scanner data held in flow nodes; only the serialized form is slim.
 */
function slimInnerArtefactForExport(raw: unknown): TritonInnerArtefactSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const id = typeof a.id === 'string' ? a.id : ''
  const name = typeof a.name === 'string' ? a.name : ''
  if (!id || !name) return null
  const subtitle = typeof a.subtitle === 'string' && a.subtitle ? a.subtitle : undefined
  return {
    id,
    name,
    ...(subtitle ? { subtitle } : {}),
  }
}

/**
 * Pick the description value to round-trip through YAML.
 *
 * When `applyDoc` builds a flow node from scanner YAML, it snapshots the scanner-emitted
 * description into `data.scannerDescription` and never modifies it again. The plain
 * `data.description` field is still allowed to be live-edited by the user (legacy
 * description editor in `PackageBox`), so reading it would mix scanner truth with user
 * notes. We always prefer the snapshot when present so the YAML output stays purely
 * derived from the most recent scan — that's what makes "diff two YAMLs to see what
 * changed in the source" actually work.
 */
function descriptionForExport(n: ExportFlowNode): string | undefined {
  const data = n.data as { description?: unknown; scannerDescription?: unknown } | undefined
  if (typeof data?.scannerDescription === 'string' && data.scannerDescription) {
    return data.scannerDescription
  }
  if (typeof data?.description === 'string' && data.description) {
    return data.description
  }
  return undefined
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
        const desc = descriptionForExport(n)
        if (desc) res.description = desc
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
      const desc = descriptionForExport(n)
      if (desc) res.description = desc
      const ip = (n.data as Record<string, unknown> | undefined)?.innerPackages
      if (Array.isArray(ip) && ip.length) {
        res['x-triton-inner-packages'] = ip as NonNullable<IlographResource['x-triton-inner-packages']>
      }
      const ia = (n.data as Record<string, unknown> | undefined)?.innerArtefacts
      if (Array.isArray(ia) && ia.length) {
        const slim = ia
          .map(slimInnerArtefactForExport)
          .filter((x): x is TritonInnerArtefactSpec => x !== null)
        if (slim.length) {
          res['x-triton-inner-artefacts'] = slim
        }
      }
      const iar = (n.data as Record<string, unknown> | undefined)?.innerArtefactRelations
      if (Array.isArray(iar) && iar.length) {
        res['x-triton-inner-artefact-relations'] = iar as NonNullable<
          IlographResource['x-triton-inner-artefact-relations']
        >
      }
      const iconKey = (n.data as Record<string, unknown> | undefined)?.tritonIconKey
      if (typeof iconKey === 'string' && iconKey.trim()) {
        res['x-triton-icon'] = iconKey.trim()
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
    const desc = descriptionForExport(n)
    patched.push({
      name: exportResourceName(n),
      subtitle: String(n.data?.subtitle ?? ''),
      ...(desc ? { description: desc } : {}),
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

  /**
   * The legacy `x-triton-editor` block (positions / moduleColors / pinnedModuleIds) is no
   * longer emitted: those user-overlay values now live in the runtime overlay store
   * (TinyBase, persisted to localStorage). Keeping them out of the YAML lets us treat the
   * YAML as pure scanner output, so diffs between two YAMLs only highlight code changes
   * (resources, declarations, relations) instead of being drowned in per-node x/y noise.
   * `parseIlographYaml` still tolerates the block on input — `App.applyDoc` migrates any
   * found legacy values into the overlay store on first load.
   */
  // Only emit a doc-level description when the caller actually supplied one. The previous
  // boilerplate fallback ("Sbt-style modules …") added a string to every exported YAML that
  // duplicated info already encoded structurally (resources + perspective relations). The
  // overlay store holds all user-specific UI state separately, so the YAML's job is strictly
  // "latest scanner output" — keep it minimal so diffs highlight real code changes only.
  return {
    ...(meta.description ? { description: meta.description } : {}),
    resources,
    perspectives,
  }
}
