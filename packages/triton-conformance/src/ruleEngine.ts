import type { CodeModel } from '../../triton-core/src/languageModel'
import type { ChangedFact, ResolvedTopology, ViolationRecord } from './types'
import { componentOf } from './topology'
import { buildMatchKey } from './matchKey'

/**
 * Deterministic rule-engine (spec [3a]): structural checks that follow directly from the topology —
 * forbidden component edges (observed edge ∉ allowed whitelist) and cycles in the observed import
 * graph. No LLM. This is the overlap with import-linter and the comparison baseline for UF3.
 *
 * It runs on observed *imports*. Per plan Correction 1 the real path feeds the FULL CodeModel
 * (cycles need the whole graph, not a diff slice); `observedImportsFromFacts` is provided so the
 * diff-only path and the fixture can exercise the same engine.
 */
export interface ObservedImport {
  fromModule: string
  toModule: string
  file: string
  line?: number
}

export function observedImportsFromCodeModel(model: CodeModel): ObservedImport[] {
  return model.relations
    .filter((r) => r.kind === 'imports' && r.scope === 'container')
    .map((r) => ({ fromModule: r.from, toModule: r.to, file: r.source?.file ?? '', line: r.source?.startRow }))
}

export function observedImportsFromFacts(facts: readonly ChangedFact[]): ObservedImport[] {
  return facts.flatMap((fact) =>
    fact.imports.map((imp) => ({ fromModule: fact.module, toModule: imp.target, file: fact.path })),
  )
}

interface ComponentEdge {
  from: string
  to: string
  /** Representative observed import that produced this edge (for violation location). */
  via: ObservedImport
}

/** Component-level edges, dropping external/unmapped endpoints and intra-component imports. */
function componentEdges(imports: readonly ObservedImport[], topology: ResolvedTopology): ComponentEdge[] {
  const edges: ComponentEdge[] = []
  for (const imp of imports) {
    const from = componentOf(topology, imp.fromModule)
    const to = componentOf(topology, imp.toModule)
    if (!from || !to || from === to) continue
    edges.push({ from, to, via: imp })
  }
  return edges
}

export function runRuleEngine(
  imports: readonly ObservedImport[],
  topology: ResolvedTopology,
): ViolationRecord[] {
  const edges = componentEdges(imports, topology)
  return [...forbiddenEdgeViolations(edges, topology), ...cycleViolations(edges)]
}

function forbiddenEdgeViolations(edges: readonly ComponentEdge[], topology: ResolvedTopology): ViolationRecord[] {
  const allowed = new Set(topology.allowedEdges.map((e) => `${e.from}->${e.to}`))
  const out = new Map<string, ViolationRecord>()
  for (const edge of edges) {
    if (allowed.has(`${edge.from}->${edge.to}`)) continue
    const record = forbiddenEdgeRecord(edge)
    out.set(record.match_key, record) // dedup per (offending module, edge)
  }
  return [...out.values()]
}

function forbiddenEdgeRecord(edge: ComponentEdge): ViolationRecord {
  const location = { file: edge.via.file, module: edge.via.fromModule, component: edge.from, line: edge.via.line }
  const subject = { from: edge.from, to: edge.to }
  return {
    rule_id: 'DERIVED:forbidden-edge',
    category: 'layer-violation',
    kind: 'structural',
    source: 'rule-engine',
    location,
    subject,
    reason: `Module ${edge.via.fromModule} imports ${edge.via.toModule}; component ${edge.from} must not depend on ${edge.to} (edge not in the allowed topology).`,
    suggestion: `Remove the dependency or invert it (define a port in ${edge.to}'s consumer and depend on the abstraction).`,
    severity: 'error',
    match_key: buildMatchKey('layer-violation', location, subject),
  }
}

/**
 * Report cycles in the observed component graph. One violation per back-edge that closes a cycle
 * (DFS over the recursion stack). Considers all observed edges, allowed or not — an architectural
 * cycle is a smell regardless of the whitelist.
 *
 * Which back-edge of a cycle is reported is a property of the traversal, not of the code under
 * test, so the traversal is canonicalized: without it the reported module — and with it the
 * match_key the eval joins on — would change when unrelated files are added or renamed. Both
 * order-dependent inputs are sorted below: every node's adjacency list, and the list of DFS roots.
 */
function cycleViolations(edges: readonly ComponentEdge[]): ViolationRecord[] {
  const adjacency = new Map<string, ComponentEdge[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? []
    list.push(edge)
    adjacency.set(edge.from, list)
  }
  // Canonical branch order per node. Target component first — that is what decides which branch the
  // DFS descends into. The representative import (module, then file, then line) only breaks ties
  // between parallel edges to the same component, so a repeated pair always elects the same witness.
  for (const list of adjacency.values()) list.sort(compareComponentEdges)

  const VISITING = 1
  const DONE = 2
  const state = new Map<string, number>()
  const out = new Map<string, ViolationRecord>()

  const visit = (node: string): void => {
    state.set(node, VISITING)
    for (const edge of adjacency.get(node) ?? []) {
      const childState = state.get(edge.to)
      if (childState === VISITING) {
        const record = cycleRecord(edge)
        out.set(record.match_key, record)
      } else if (childState === undefined) {
        visit(edge.to)
      }
    }
    state.set(node, DONE)
  }

  // Canonical root order: ascending component name, so the walk always starts at the same node.
  for (const node of [...adjacency.keys()].sort(compareStrings)) {
    if (state.get(node) === undefined) visit(node)
  }
  return [...out.values()]
}

/** Code-unit order. Deliberately not localeCompare, whose result depends on the runtime locale. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Total order on the edges leaving one component; see the sort key note in cycleViolations. */
function compareComponentEdges(a: ComponentEdge, b: ComponentEdge): number {
  return (
    compareStrings(a.to, b.to) ||
    compareStrings(a.via.fromModule, b.via.fromModule) ||
    compareStrings(a.via.file, b.via.file) ||
    (a.via.line ?? -1) - (b.via.line ?? -1)
  )
}

function cycleRecord(edge: ComponentEdge): ViolationRecord {
  const location = { file: edge.via.file, module: edge.via.fromModule, component: edge.from, line: edge.via.line }
  const subject = { from: edge.from, to: edge.to }
  return {
    rule_id: 'DERIVED:cycle',
    category: 'cycle',
    kind: 'structural',
    source: 'rule-engine',
    location,
    subject,
    reason: `Import ${edge.via.fromModule} → ${edge.via.toModule} closes a dependency cycle between components ${edge.from} and ${edge.to}.`,
    suggestion: `Break the cycle: extract the shared abstraction into a component both can depend on.`,
    severity: 'error',
    match_key: buildMatchKey('cycle', location, subject),
  }
}
