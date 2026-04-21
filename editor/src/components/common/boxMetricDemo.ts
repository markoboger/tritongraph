import type { BoxIssueLevel } from './BoxMetricStrip.vue'

export type BoxMetricDemo = {
  technicalDebtPercent: number
  issueCount: number
  issueLevel: BoxIssueLevel
}

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function simulatedMetricsForBox(id: string): BoxMetricDemo {
  const h = hashString(String(id ?? ''))
  const technicalDebtPercent = ((h % 101) / 10)
  const issueCount = (Math.floor(h / 101) % 8)
  const issueLevel: BoxIssueLevel =
    issueCount >= 6 ? 'blocking' : issueCount >= 3 ? 'major' : issueCount >= 1 ? 'minor' : 'none'
  return {
    technicalDebtPercent: Math.round(technicalDebtPercent * 10) / 10,
    issueCount,
    issueLevel,
  }
}
