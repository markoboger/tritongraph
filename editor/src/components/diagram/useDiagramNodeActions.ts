import { useVueFlow } from '@vue-flow/core'
import { inject, nextTick } from 'vue'
import { boxColorForId, nextNamedBoxColor } from '../../graph/boxColors'
import { setNodeColor, setNodeNotes, setNodePinned } from '../../store/overlayStore'
import { TRITON_WORKSPACE_FLOW_ID } from '../../graph/tritonVueFlowId'

export function useDiagramNodeActions(options: {
  nodeId: string
  label: () => string | undefined
  notes: () => string | undefined
  pinned: () => boolean | undefined
  boxColor: () => string | undefined
}) {
  const { updateNodeData } = useVueFlow(TRITON_WORKSPACE_FLOW_ID)

  const workspaceKey = inject<{ value: string } | undefined>('tritonWorkspaceKey', undefined)
  const refreshDimming = inject<(() => void) | undefined>('tritonRefreshDimming', undefined)
  const relayoutViewport = inject<(() => void | Promise<void>) | undefined>('tritonRelayoutViewport', undefined)
  const patchNodeData = inject<((id: string, patch: Record<string, unknown>) => void) | undefined>(
    'tritonPatchNodeData',
    undefined,
  )

  function ws(): string {
    return workspaceKey?.value ?? ''
  }

  function patchData(patch: Record<string, unknown>) {
    updateNodeData(options.nodeId, patch)
    patchNodeData?.(options.nodeId, patch)
  }

  function cycleColor() {
    const accent = options.boxColor() || boxColorForId(options.nodeId)
    const next = nextNamedBoxColor(accent)
    patchData({ boxColor: next })
    setNodeColor(ws(), options.nodeId, next)
  }

  function onRename(newLabel: string) {
    if (!newLabel || newLabel === options.label()) return
    patchData({ label: newLabel })
  }

  function onDescriptionChange(newDescription: string) {
    const cur = options.notes() ?? ''
    if (newDescription === cur) return
    patchData({ notes: newDescription })
    setNodeNotes(ws(), options.nodeId, newDescription)
  }

  function togglePin(ev: MouseEvent) {
    ev.stopPropagation()
    const next = !options.pinned()
    patchData({ pinned: next })
    setNodePinned(ws(), options.nodeId, next)
    void nextTick(async () => {
      refreshDimming?.()
      await relayoutViewport?.()
    })
  }

  return {
    updateNodeData,
    patchNodeData,
    ws,
    patchData,
    cycleColor,
    onRename,
    onDescriptionChange,
    togglePin,
  }
}
