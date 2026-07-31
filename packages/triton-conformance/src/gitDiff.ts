import { execFileSync } from 'node:child_process'
import type { DiffKind } from './types'

/**
 * Node-only: list changed Python files via `git diff --name-status`. Kept OUT of index.ts so the
 * browser bundle (editor) never pulls in `node:child_process`. The CLI imports this directly.
 */
export interface ChangedPythonFile {
  /** Path relative to the repo root. */
  path: string
  diff_kind: DiffKind
}

export interface GitDiffOptions {
  repoRoot: string
  /** Base to diff against. Default 'HEAD' = uncommitted working-tree changes. */
  base?: string
}

export function changedPythonFiles({ repoRoot, base = 'HEAD' }: GitDiffOptions): ChangedPythonFile[] {
  const output = execFileSync('git', ['diff', '--name-status', base], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(parseNameStatus)
    .filter((entry): entry is ChangedPythonFile => entry !== null && entry.path.endsWith('.py'))
}

/** `git rev-parse HEAD` in `dir`, or null when that is not a git checkout / git is unavailable. */
export function gitHead(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function parseNameStatus(line: string): ChangedPythonFile | null {
  // Formats: "M\tpath", "A\tpath", "R100\told\tnew" (renames).
  const parts = line.split('\t')
  const status = parts[0][0]
  const path = parts[parts.length - 1]
  if (!path) return null
  // Added counts as added; modified/renamed/copied as modified; deleted has no current file to check.
  if (status === 'D') return null
  return { path, diff_kind: status === 'A' ? 'added' : 'modified' }
}
