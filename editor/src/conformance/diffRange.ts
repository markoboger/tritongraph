import { reactive } from 'vue'

/**
 * Which two revisions the git diff compares, shared by the diagram overlay and the conformance page
 * so a range set in one applies to the other. `head` empty = the working tree. `merge-base` = what
 * head introduced since it branched off (PR review); `direct` = the two states as they are.
 */
export interface DiffRange {
  base: string
  head: string
  mode: 'merge-base' | 'direct'
}

export const DEFAULT_DIFF_RANGE: Readonly<DiffRange> = { base: 'HEAD~1', head: '', mode: 'merge-base' }

const STORAGE_KEY = 'triton.diffRanges'

const rangesByWorkspace = reactive<Record<string, DiffRange>>(loadStoredRanges())

function loadStoredRanges(): Record<string, DiffRange> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, DiffRange>
  } catch {
    return {}
  }
}

/** A copy, so a caller editing it (e.g. a picker draft) never mutates the applied range. */
export function diffRangeFor(workspacePath: string): DiffRange {
  return { ...(rangesByWorkspace[workspacePath] ?? DEFAULT_DIFF_RANGE) }
}

export function setDiffRange(workspacePath: string, range: DiffRange): void {
  rangesByWorkspace[workspacePath] = { ...range }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rangesByWorkspace))
  } catch {
    // Storage unavailable (private window) — the range still holds for this session.
  }
}

/** `main…feature/x` (merge-base) or `main..feature/x` (direct), as git spells the two range kinds. */
export function diffRangeLabel(range: DiffRange): string {
  return `${range.base}${range.mode === 'merge-base' ? '…' : '..'}${range.head || 'working tree'}`
}

/** Query params the runtime's git-diff endpoints take. */
export function setDiffRangeParams(url: URL, range: DiffRange): void {
  url.searchParams.set('base', range.base)
  if (range.head) url.searchParams.set('head', range.head)
  url.searchParams.set('mode', range.mode)
}
