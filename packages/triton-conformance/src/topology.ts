import type { IlographDocument, IlographResource } from '../../triton-core/src/ilographTypes'
import type { ResolvedTopology, AllowedEdge } from './types'

/**
 * Compile a refined Ilograph topology (the "Soll", §3.1a) into the lookups the checker needs.
 *
 * Convention (spec §3.1a): components are the resources that appear as endpoints in
 * `perspectives[].relations` ("Abhängigkeiten zwischen Komponenten"). Every resource nested under a
 * component resource is a module belonging to that component. The relations are the allowed-edge
 * whitelist — anything not listed is forbidden.
 *
 * The caller parses the YAML (the editor/CLI both have js-yaml); this stays dependency-free and pure.
 *
 * ponytail: a component with no relations isn't detected (its modules resolve to unmapped). Edges are
 * authored deliberately in the Soll, so an edge-less component is degenerate; add explicit
 * component-marking if that case ever shows up.
 */
export function resolveTopology(doc: IlographDocument): ResolvedTopology {
  const relations = (doc.perspectives ?? []).flatMap((p) => p.relations ?? [])

  const componentSet = new Set<string>()
  for (const rel of relations) {
    if (rel.from) componentSet.add(rel.from)
    if (rel.to) componentSet.add(rel.to)
  }

  const moduleToComponent: Record<string, string> = {}
  const visit = (resource: IlographResource, inheritedComponent: string | null): void => {
    const id = resource.id ?? resource.name
    const isComponent = componentSet.has(id)
    const component = isComponent ? id : inheritedComponent
    // A non-component resource under a component is a module of that component.
    if (!isComponent && component) moduleToComponent[id] = component
    for (const child of resource.children ?? []) visit(child, component)
  }
  for (const resource of doc.resources ?? []) visit(resource, null)

  const seen = new Set<string>()
  const allowedEdges: AllowedEdge[] = []
  for (const rel of relations) {
    if (!rel.from || !rel.to) continue
    const key = `${rel.from}->${rel.to}`
    if (seen.has(key)) continue
    seen.add(key)
    allowedEdges.push({ from: rel.from, to: rel.to })
  }

  return { moduleToComponent, components: [...componentSet], allowedEdges }
}

/** Resolve a (dotted) module path to its component, or null if unmapped. */
export function componentOf(topology: ResolvedTopology, module: string): string | null {
  return topology.moduleToComponent[module] ?? null
}
