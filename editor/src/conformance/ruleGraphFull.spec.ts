/**
 * `--rule-graph full`: the deterministic rule-engine over every *.py under the source roots instead
 * of the diff slice. Runs the real python3 extractor against throwaway repos, wired exactly like
 * cli.ts wires it (extractFacts → observedImportsFromFacts → check), so the test covers the CLI path.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  extractFacts,
  pythonFilesUnder,
} from '../../../packages/triton-conformance/src/cliExtractor'
import { observedImportsFromFacts } from '../../../packages/triton-conformance/src/ruleEngine'
import { check } from '../../../packages/triton-conformance/src/check'
import { allViolations, exitCode } from '../../../packages/triton-conformance/src/reporter'
import type { CheckResult } from '../../../packages/triton-conformance/src/types'
import { sollModel, topology } from '../../../packages/triton-conformance/fixtures/miniRepo'

const repos: string[] = []
afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-conformance-'))
  repos.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

function runRules(repoRoot: string, graphFacts: Parameters<typeof observedImportsFromFacts>[0]) {
  return check({
    soll: sollModel,
    changedFacts: [],
    observedImports: observedImportsFromFacts(graphFacts),
  })
}

const categories = (results: readonly CheckResult[]) => allViolations(results).map((v) => v.category)

describe('rule-graph full', () => {
  it('finds a cycle that closes through an unchanged file, which diff mode misses', async () => {
    // api → domain → infra → api: only the first edge is in the diff, the other two are not.
    const repo = writeRepo({
      'app/api/routes.py': 'from app.domain.order import make_order\n',
      'app/domain/order.py': 'from app.infra.db import save\n',
      'app/infra/db.py': 'from app.api.routes import handle\n',
    })
    const changed = [{ path: 'app/api/routes.py', diff_kind: 'modified' as const }]

    const diff = extractFacts(repo, changed, topology)
    const full = extractFacts(repo, pythonFilesUnder(repo), topology)
    expect(full.facts.map((f) => f.path)).toEqual([
      'app/api/routes.py',
      'app/domain/order.py',
      'app/infra/db.py',
    ])

    const diffResults = await runRules(repo, diff.facts)
    expect(categories(diffResults)).toEqual([]) // api → domain is allowed; the rest is invisible
    expect(exitCode(diffResults)).toBe(0)

    const fullResults = await runRules(repo, full.facts)
    expect(categories(fullResults)).toContain('cycle')
    expect(exitCode(fullResults)).toBe(1)
  })

  it('skips an unparseable file instead of aborting the run, leaving the exit code untouched', async () => {
    const repo = writeRepo({
      'app/domain/order.py': 'from app.domain.pricing import quote\n',
      'app/infra/broken.py': 'def (:\n',
    })

    const extracted = extractFacts(repo, pythonFilesUnder(repo), topology)
    expect(extracted.skipped).toEqual([
      { path: 'app/infra/broken.py', reason: expect.stringContaining('SyntaxError') },
    ])
    expect(extracted.facts.map((f) => f.path)).toEqual(['app/domain/order.py'])

    // The surviving file has no violation, so the run still exits 0 despite the skipped file.
    expect(exitCode(await runRules(repo, extracted.facts))).toBe(0)
  })
})
