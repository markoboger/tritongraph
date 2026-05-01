import { computed, inject, onScopeDispose, ref, type Ref } from 'vue'
import type { TritonInnerArtefactSpec } from '../../ilograph/types'
import { boxColorForId, nextNamedBoxColor } from '../../graph/boxColors'
import { openInEditor } from '../../openInEditor'
import { getScalaCoverage, onScalaCoverageChanged } from '../../store/overlayStore'
import { simulatedMetricsForBox } from '../common/boxMetricDemo'

type InnerArtefactStateOptions = {
  innerArtefacts: () => readonly TritonInnerArtefactSpec[]
  innerArtefactPinned: () => Readonly<Record<string, boolean>> | undefined
  innerArtefactColors: () => Readonly<Record<string, string>> | undefined
  updateInnerArtefactPinned: (next: Record<string, boolean>) => void
  updateInnerArtefactColors: (next: Record<string, string>) => void
  updateInnerArtefactFocus: (id: string | null) => void
}

export function useInnerArtefactState(options: InnerArtefactStateOptions) {
  const activeExampleRef = inject<Ref<{ root: string; dir: string } | null> | undefined>(
    'tritonActiveExample',
    undefined,
  )
  const runtimeWorkspaceSession = inject<Ref<{ workspacePath: string; workspaceName: string; runtimeUrl: string } | null> | undefined>(
    'tritonRuntimeWorkspaceSession',
    undefined,
  )
  const openRuntimeSourceTab = inject<((relPath: string, line?: number) => void) | undefined>(
    'tritonOpenRuntimeSourceTab',
    undefined,
  )
  const workspaceKeyRef = inject<Ref<string>>('tritonWorkspaceKey', ref(''))

  const innerCoverageVersion = ref(0)
  const offInnerCoverage = onScalaCoverageChanged(() => {
    innerCoverageVersion.value += 1
  })
  onScopeDispose(offInnerCoverage)

  const innerArtefactById = computed(() => {
    const m = new Map<string, TritonInnerArtefactSpec>()
    for (const a of options.innerArtefacts()) m.set(a.id, a)
    return m
  })

  function innerArtefactCell(id: string): TritonInnerArtefactSpec | undefined {
    return innerArtefactById.value.get(id)
  }

  function openInnerArtefactInEditor(artId: string, line?: number): void {
    const cell = innerArtefactCell(artId)
    if (!cell || !cell.sourceFile) return
    const effectiveRow = line !== undefined ? line : (cell.sourceRow ?? 0)
    if (runtimeWorkspaceSession?.value && openRuntimeSourceTab) {
      openRuntimeSourceTab(cell.sourceFile, effectiveRow + 1)
      return
    }
    const ex = activeExampleRef?.value
    if (!ex) return
    openInEditor({
      root: ex.root,
      exampleDir: ex.dir,
      relPath: cell.sourceFile,
      line: effectiveRow + 1,
    })
  }

  function canOpenInnerArtefactInEditor(artId: string): boolean {
    if (!innerArtefactCell(artId)?.sourceFile) return false
    if (runtimeWorkspaceSession?.value) return true
    return !!activeExampleRef?.value
  }

  function innerCoveragePercent(id: string): number | null {
    void innerCoverageVersion.value
    const ws = workspaceKeyRef.value ?? ''
    const v = getScalaCoverage(ws, id)?.stmtPct
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
    return null
  }

  function innerHasCoverage(id: string): boolean {
    return innerCoveragePercent(id) !== null
  }

  function innerCoveragePercentValue(id: string): number {
    return innerCoveragePercent(id) ?? 0
  }

  function innerSimulatedMetrics(id: string) {
    return simulatedMetricsForBox(id)
  }

  function isInnerArtefactPinned(id: string): boolean {
    return !!options.innerArtefactPinned()?.[id]
  }

  function innerArtefactAccent(id: string): string {
    return options.innerArtefactColors()?.[id] ?? boxColorForId(id)
  }

  function onInnerArtefactTogglePin(id: string, ev: MouseEvent) {
    ev.stopPropagation()
    const cur = options.innerArtefactPinned() ?? {}
    const next = { ...cur }
    if (next[id]) delete next[id]
    else next[id] = true
    options.updateInnerArtefactPinned(next)
  }

  function onInnerArtefactCycleColor(id: string) {
    const cur = options.innerArtefactColors() ?? {}
    const currentColor = cur[id] ?? boxColorForId(id)
    options.updateInnerArtefactColors({ ...cur, [id]: nextNamedBoxColor(currentColor) })
  }

  function onArtefactRowClick(id: string) {
    options.updateInnerArtefactFocus(id)
  }

  function onFocusedArtefactBackgroundClick(ev: MouseEvent) {
    ev.stopPropagation()
    options.updateInnerArtefactFocus(null)
  }

  return {
    innerCoverageVersion,
    innerArtefactCell,
    openInnerArtefactInEditor,
    canOpenInnerArtefactInEditor,
    innerHasCoverage,
    innerCoveragePercentValue,
    innerSimulatedMetrics,
    isInnerArtefactPinned,
    innerArtefactAccent,
    onInnerArtefactTogglePin,
    onInnerArtefactCycleColor,
    onArtefactRowClick,
    onFocusedArtefactBackgroundClick,
  }
}
