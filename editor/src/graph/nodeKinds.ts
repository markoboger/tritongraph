/**
 * Vue Flow node `type` values that represent a single, user-visible box in the diagram (i.e. one
 * leaf of the dependency graph). Excludes `group`, which is a layout container.
 *
 * Layout, drill-in, depth math, color/pin round-trip and the "find by label" helpers all branch on
 * "is this a leaf box?". Today the leaves are sbt project boxes (`module`), Scala package boxes
 * (`package`) and Scala artefacts (`artefact`: classes / objects / traits / enums / top-level defs).
 * Add future node kinds (e.g. `file`, `service`) here so they participate in those flows
 * automatically.
 */
export const LEAF_BOX_NODE_TYPES: readonly string[] = ['module', 'package', 'artefact']

const LEAF_SET: ReadonlySet<string> = new Set(LEAF_BOX_NODE_TYPES)

export function isLeafBoxNode(n: { type?: string | null } | null | undefined): boolean {
  return !!n && LEAF_SET.has(String(n.type ?? ''))
}

/**
 * Either a leaf box (project / package / artefact) or a `group` container. These are the nodes
 * that participate in depth-layered drill-in: they can claim a column in their parent region,
 * be hidden as same-depth peers, animate via FLIP, etc. Container groups are "boxes that contain
 * boxes", but for the purpose of column layout and layer drill they look the same as a leaf —
 * they're just a wider, taller box whose children get re-laid-out inside.
 */
export function isLayerDrillBoxNode(n: { type?: string | null } | null | undefined): boolean {
  if (!n) return false
  const t = String(n.type ?? '')
  return LEAF_SET.has(t) || t === 'group'
}
