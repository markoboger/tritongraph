import { computed, inject, ref, type Ref } from 'vue'
import { useScalaCoverageKeyed } from '../../store/useOverlay'
import { simulatedMetricsForBox } from './boxMetricDemo'

export function useBoxMetrics(boxId: () => string | undefined) {
  const workspaceKeyRef = inject<Ref<string>>('tritonWorkspaceKey', ref(''))
  const scalaCoverageRef = useScalaCoverageKeyed(workspaceKeyRef, String(boxId() ?? ''))

  const coveragePercent = computed((): number | null => {
    const value = scalaCoverageRef.value?.stmtPct
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  })
  const hasCoverage = computed(() => coveragePercent.value !== null)
  const coveragePercentValue = computed(() => coveragePercent.value ?? 0)
  const simulatedMetrics = computed(() => simulatedMetricsForBox(boxId() ?? ''))

  return {
    coveragePercent,
    hasCoverage,
    coveragePercentValue,
    simulatedMetrics,
  }
}
