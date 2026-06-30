import type { CodeModel, CodeContainer } from '../../triton-core/src/languageModel'
import type { ResolvedTopology, AllowedEdge } from './types'
import { observedImportsFromCodeModel } from './ruleEngine'

export interface DeriveTopologyOptions {
  /** Leading dotted segments that name a component (e.g. depth 2 → `clinic.staff`). Default 2. */
  componentDepth?: number
}

/**
 * Derive an as-is ("Ist") topology from a parsed project — the hybrid path when there is no
 * `ilograph.yaml` to load (Increment 7b). Components are the dotted module prefix up to
 * `componentDepth`; the allowed edges are exactly the observed component-to-component imports. The
 * UI then lets the user *remove* edges to tighten the Soll — anything removed becomes forbidden.
 *
 * Pure (no parsing, no I/O), mirroring `resolveTopology` so the CLI can reuse it later.
 */
export function deriveTopologyFromCodeModel(
  model: CodeModel,
  options: DeriveTopologyOptions = {},
): ResolvedTopology {
  const depth = Math.max(1, options.componentDepth ?? 2)
  const componentName = (module: string): string => module.split('.').slice(0, depth).join('.')

  const moduleToComponent: Record<string, string> = {}
  const components = new Set<string>()
  for (const module of collectModules(model.root)) {
    const component = componentName(module)
    moduleToComponent[module] = component
    components.add(component)
  }

  const seen = new Set<string>()
  const allowedEdges: AllowedEdge[] = []
  for (const imp of observedImportsFromCodeModel(model)) {
    const from = moduleToComponent[imp.fromModule]
    const to = moduleToComponent[imp.toModule]
    if (!from || !to || from === to || seen.has(`${from}->${to}`)) continue
    seen.add(`${from}->${to}`)
    allowedEdges.push({ from, to })
  }

  return { moduleToComponent, components: [...components], allowedEdges }
}

/** Dotted ids of every module/package container under the workspace root. */
function collectModules(container: CodeContainer, out: string[] = []): string[] {
  if (container.kind === 'module' || container.kind === 'package') out.push(container.id)
  for (const child of container.children) collectModules(child, out)
  return out
}
