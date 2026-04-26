import { computed, inject, type Ref } from 'vue'

type NodeLike = {
  id: string
  parentNode?: unknown
}

function moduleInContainerFocusTree(
  nodes: readonly NodeLike[],
  focusId: string,
  moduleId: string,
): boolean {
  if (focusId === moduleId) return true
  const desc = new Set<string>([focusId])
  let frontier = [focusId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const n of nodes) {
        if (String(n.parentNode) === id && !desc.has(n.id)) {
          desc.add(n.id)
          next.push(n.id)
        }
      }
    }
    frontier = next
  }
  if (desc.has(moduleId)) return true
  let cur = nodes.find((n) => n.id === moduleId)
  while (cur?.parentNode) {
    const pid = String(cur.parentNode)
    if (pid === focusId) return true
    cur = nodes.find((n) => n.id === pid)
  }
  return false
}

export function useDiagramNodePinTool(options: {
  nodeId: string
  nodes: Ref<readonly NodeLike[]>
  pinned: () => boolean | undefined
  layerDrillFocus: () => boolean | undefined
}) {
  const graphFocusUi = inject<{ containerFocusId: string | null } | undefined>('tritonGraphFocusUi', undefined)

  return computed(() => {
    if (options.pinned()) return true
    if (options.layerDrillFocus()) return true
    const focusId = graphFocusUi?.containerFocusId
    if (!focusId) return false
    return moduleInContainerFocusTree(options.nodes.value, focusId, options.nodeId)
  })
}
