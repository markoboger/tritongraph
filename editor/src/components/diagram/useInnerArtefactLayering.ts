import { computed } from 'vue'
import type { TritonInnerArtefactRelationSpec, TritonInnerArtefactSpec } from '../../ilograph/types'
import { assignInnerArtefactLayers } from '../../graph/innerArtefactLayerLayout'

type InnerArtefactLayeringOptions = {
  focused: () => boolean
  innerDrillPath: () => readonly string[]
  innerArtefacts: () => readonly TritonInnerArtefactSpec[]
  innerArtefactRelations: () => readonly TritonInnerArtefactRelationSpec[]
  crossArtefactRelations: () => readonly TritonInnerArtefactRelationSpec[]
  focusedInnerArtefactId: () => string | null | undefined
  globalFocusedArtefactId: () => string | null | undefined
  focusRelationDepth: () => number
}

function normalizedFocusDepth(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(3, Math.round(value))) : 1
}

function directedRelationNeighborhood(
  seeds: { outgoing: Iterable<string>; incoming: Iterable<string> },
  rels: readonly TritonInnerArtefactRelationSpec[],
  maxDepth: number,
): Set<string> {
  const depth = Number.isFinite(maxDepth) ? Math.max(0, Math.min(3, Math.round(maxDepth))) : 1
  const visible = new Set<string>()
  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, Set<string>>()
  const ensure = (map: Map<string, Set<string>>, id: string) => {
    let next = map.get(id)
    if (!next) {
      next = new Set<string>()
      map.set(id, next)
    }
    return next
  }

  for (const rel of rels) {
    if (!rel.from || !rel.to) continue
    ensure(outgoing, rel.from).add(rel.to)
    ensure(incoming, rel.to).add(rel.from)
    ensure(outgoing, rel.to)
    ensure(incoming, rel.from)
  }

  const visit = (seedIds: Iterable<string>, map: Map<string, Set<string>>) => {
    const frontier: string[] = []
    const distance = new Map<string, number>()
    for (const id of seedIds) {
      if (!id) continue
      visible.add(id)
      frontier.push(id)
      distance.set(id, 0)
    }

    for (let i = 0; i < frontier.length; i++) {
      const id = frontier[i]!
      const currentDepth = distance.get(id) ?? 0
      if (currentDepth >= depth) continue
      for (const next of map.get(id) ?? []) {
        if (distance.has(next)) continue
        visible.add(next)
        distance.set(next, currentDepth + 1)
        frontier.push(next)
      }
    }
  }

  visit(seeds.outgoing, outgoing)
  visit(seeds.incoming, incoming)
  return visible
}

export function useInnerArtefactLayering(options: InnerArtefactLayeringOptions) {
  const allInnerArtefactRelations = computed((): readonly TritonInnerArtefactRelationSpec[] => {
    const rels = options.innerArtefactRelations()
    return Array.isArray(rels) ? rels : []
  })

  const innerArtefactFocusActive = computed(
    () => !!options.focusedInnerArtefactId() && !options.innerDrillPath().length,
  )

  const focusFilteredIds = computed((): Set<string> | null => {
    const rels = allInnerArtefactRelations.value
    const innerArtefacts = options.innerArtefacts()
    const localIds = new Set(innerArtefacts.map((a) => a.id))
    const focusedInnerArtefactId = options.focusedInnerArtefactId()
    const focusDepth = normalizedFocusDepth(options.focusRelationDepth())

    if (innerArtefactFocusActive.value && focusedInnerArtefactId) {
      return directedRelationNeighborhood(
        { outgoing: [focusedInnerArtefactId], incoming: [focusedInnerArtefactId] },
        rels,
        focusDepth,
      )
    }

    const globalId = options.globalFocusedArtefactId()
    if (globalId && !localIds.has(globalId)) {
      const crossRels = options.crossArtefactRelations()
      const outgoingSeeds = new Set<string>()
      const incomingSeeds = new Set<string>()
      for (const rel of crossRels) {
        if (rel.from === globalId && localIds.has(rel.to)) outgoingSeeds.add(rel.to)
        if (rel.to === globalId && localIds.has(rel.from)) incomingSeeds.add(rel.from)
      }
      if (!outgoingSeeds.size && !incomingSeeds.size) return null
      return directedRelationNeighborhood(
        { outgoing: outgoingSeeds, incoming: incomingSeeds },
        rels,
        focusDepth - 1,
      )
    }

    return null
  })

  const crossPackagePreviewActive = computed(() => {
    if (options.focused()) return false
    const ids = focusFilteredIds.value
    return ids !== null && ids.size > 0
  })

  const innerArtefactLayerColumns = computed((): string[][] => {
    const filter = focusFilteredIds.value
    const allIds = options.innerArtefacts().map((a) => a.id)
    const ids = filter ? allIds.filter((id) => filter.has(id)) : allIds
    if (!ids.length) return []
    const rels = allInnerArtefactRelations.value
    const filteredRels = filter ? rels.filter((r) => filter.has(r.from) && filter.has(r.to)) : rels
    if (!filteredRels.length) return [ids]
    return assignInnerArtefactLayers(ids, filteredRels)
  })

  return {
    allInnerArtefactRelations,
    innerArtefactFocusActive,
    focusFilteredIds,
    crossPackagePreviewActive,
    innerArtefactLayerColumns,
  }
}
