import { computed } from 'vue'
import type { TritonInnerArtefactSpec, TritonInnerPackageSpec } from '../../ilograph/types'

type InnerPackageDrillOptions = {
  innerPackages: () => readonly TritonInnerPackageSpec[]
  innerArtefacts: () => readonly TritonInnerArtefactSpec[]
  innerDrillPath: () => readonly string[]
  updateInnerDrillPath: (path: readonly string[]) => void
  updateInnerArtefactFocus: (id: string | null) => void
}

function findSpecAtPath(
  roots: readonly TritonInnerPackageSpec[],
  path: readonly string[],
): TritonInnerPackageSpec | null {
  let level: readonly TritonInnerPackageSpec[] = roots
  let found: TritonInnerPackageSpec | null = null
  for (const segment of path) {
    const hit = level.find((x) => x.id === segment)
    if (!hit) return null
    found = hit
    level = hit.innerPackages ?? []
  }
  return found
}

export function useInnerPackageDrill(options: InnerPackageDrillOptions) {
  const innerDrillPathArr = computed(() => [...options.innerDrillPath()])

  const activeInnerSpec = computed((): TritonInnerPackageSpec | null => {
    const path = innerDrillPathArr.value
    if (!path.length) return null
    return findSpecAtPath(options.innerPackages(), path)
  })

  const topLevelInnerPackages = computed((): readonly TritonInnerPackageSpec[] => {
    const innerPackages = options.innerPackages()
    return Array.isArray(innerPackages) ? innerPackages : []
  })

  const hasInnerDiagram = computed(
    () =>
      options.innerPackages().length > 0
      || (options.innerArtefacts().length > 0 && !innerDrillPathArr.value.length),
  )

  function onInnerCardClick(id: string) {
    const p = innerDrillPathArr.value
    if (p.length && p[p.length - 1] === id) {
      options.updateInnerDrillPath(p.slice(0, -1))
      return
    }
    options.updateInnerDrillPath([...p, id])
  }

  function clearInnerDrill() {
    options.updateInnerDrillPath([])
    options.updateInnerArtefactFocus(null)
  }

  function innerDrillBackOne() {
    const p = innerDrillPathArr.value
    if (p.length) options.updateInnerDrillPath(p.slice(0, -1))
  }

  return {
    innerDrillPathArr,
    activeInnerSpec,
    topLevelInnerPackages,
    hasInnerDiagram,
    onInnerCardClick,
    clearInnerDrill,
    innerDrillBackOne,
  }
}
