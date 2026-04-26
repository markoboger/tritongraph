import type { OnResize } from '@vue-flow/node-resizer'
import { computed, inject, type ComputedRef } from 'vue'

export type AbstractionDojoResizeConfig = {
  linked: boolean
  nodeIds: readonly string[]
}

const absentResizeCfg = computed(() => null as AbstractionDojoResizeConfig | null)

export function useAbstractionNodeResize(nodeId: string) {
  const cfg = inject<ComputedRef<AbstractionDojoResizeConfig | null>>(
    'tritonAbstractionResize',
    absentResizeCfg,
  )
  const patchAbstractionResize = inject<
    | ((id: string, patch: { width: number; height: number; x: number; y: number }) => void)
    | undefined
  >('tritonPatchAbstractionResize', undefined)

  const showResizer = computed(() => {
    const c = cfg.value
    return !!c && c.nodeIds.includes(nodeId)
  })

  function onResize(ev: OnResize) {
    if (!patchAbstractionResize) return
    patchAbstractionResize(nodeId, ev.params)
  }

  return { showResizer, onResize }
}
