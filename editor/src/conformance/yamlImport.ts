import yaml from 'js-yaml'
import { parseArchitectureRules } from '../../../packages/triton-conformance/src/rules'
import { resolveTopology } from '../../../packages/triton-conformance/src/topology'
import type { ArchitectureRule, ResolvedTopology } from '../../../packages/triton-conformance/src/types'
import type { IlographDocument } from '../../../packages/triton-core/src/ilographTypes'

/**
 * Validating readers for the two Soll files a user can bring into the conformance checker. Both
 * throw an Error whose message says what is wrong, so the caller can show it and keep its current
 * state instead of silently falling back to something else.
 */

/** Parse an `architecture-rules.yaml` text into rules, or throw with a field-level reason. */
export function readRulesYaml(text: string): ArchitectureRule[] {
  return parseArchitectureRules(loadYaml(text))
}

/** Parse a target-topology `ilograph.yaml` text into a resolved topology, or throw with a reason. */
export function readSollYaml(text: string): ResolvedTopology {
  const doc = loadYaml(text)
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('expected an Ilograph document (an object with resources and perspectives)')
  }
  const topology = resolveTopology(doc as IlographDocument)
  if (topology.components.length === 0) {
    throw new Error('no components found: perspectives[].relations is empty')
  }
  return topology
}

function loadYaml(text: string): unknown {
  try {
    return yaml.load(text)
  } catch (err) {
    throw new Error(`invalid YAML: ${err instanceof Error ? err.message : String(err)}`)
  }
}
