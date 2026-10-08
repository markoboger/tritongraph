/**
 * `--base main` on a feature branch must list only the branch's own changes, not the inverse of
 * commits that landed on main after the branch forked.
 */
import { afterAll, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedPythonFiles } from '../../../packages/triton-conformance/src/gitDiff'

const repo = mkdtempSync(join(tmpdir(), 'triton-merge-base-'))
afterAll(() => rmSync(repo, { recursive: true, force: true }))

const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
const commit = (msg: string) => git('-c', 'user.email=t@e.st', '-c', 'user.name=t', 'commit', '-qam', msg)

it('lists only what the checked-out branch changed since it forked off base', () => {
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'main_only.py'), 'A = 1\n')
  git('add', '-A')
  commit('c0')
  git('checkout', '-qb', 'feature')
  writeFileSync(join(repo, 'feature.py'), 'B = 1\n')
  git('add', '-A')
  commit('c1')
  git('checkout', '-q', 'main')
  writeFileSync(join(repo, 'main_only.py'), 'A = 2\n')
  commit('c2')
  git('checkout', '-q', 'feature')

  expect(changedPythonFiles({ repoRoot: repo, base: 'main' })).toEqual([{ path: 'feature.py', diff_kind: 'added' }])
})
