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

    if (innerArtefactFocusActive.value && focusedInnerArtefactId) {
      const direct = new Set<string>([focusedInnerArtefactId])
      for (const rel of rels) {
        if (rel.from === focusedInnerArtefactId) direct.add(rel.to)
        if (rel.to === focusedInnerArtefactId) direct.add(rel.from)
      }
      const visible = new Set(direct)
      for (const rel of rels) {
        if (direct.has(rel.from)) visible.add(rel.to)
        if (direct.has(rel.to)) visible.add(rel.from)
      }
      return visible
    }

    const globalId = options.globalFocusedArtefactId()
    if (globalId && !localIds.has(globalId)) {
      const crossRels = options.crossArtefactRelations()
      const locallyConnected = new Set<string>()
      for (const rel of crossRels) {
        if (rel.from === globalId && localIds.has(rel.to)) locallyConnected.add(rel.to)
        if (rel.to === globalId && localIds.has(rel.from)) locallyConnected.add(rel.from)
      }
      if (!locallyConnected.size) return null
      const visible = new Set(locallyConnected)
      for (const rel of rels) {
        if (locallyConnected.has(rel.from)) visible.add(rel.to)
        if (locallyConnected.has(rel.to)) visible.add(rel.from)
      }
      return visible
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
