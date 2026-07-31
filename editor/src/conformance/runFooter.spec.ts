/**
 * run_footer and exit code 3: an unattended measurement run has to be able to report its own
 * failure. Every invocation closes its log with a footer — even when it throws — and a run that
 * finished but is not a sound measurement exits 3 rather than hiding behind 0 or 1.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import { allViolations } from '../../../packages/triton-conformance/src/reporter'
import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'

const repos: string[] = []
afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const SOLL_YAML = `
resources:
  - id: domain
    children: [{ id: app.domain.pricing }]
  - id: infra
    children: [{ id: app.infra.db }]
perspectives:
  - name: dependencies
    relations:
      - { from: infra, to: domain }
`

const RULES_YAML = `
rules:
  - id: no-domain-framework-coupling
    category: semantic-framework-leak
    kind: semantic
    scope: { components: [domain] }
    statement: Domain logic must not reference framework concepts, neither via import nor signature.
    severity: error
`

const CLEAN_RESPONSE = JSON.stringify({ violations: [] })

const VIOLATION_RESPONSE = JSON.stringify({
  violations: [
    {
      rule_id: 'no-domain-framework-coupling',
      symbol: 'quote',
      line: 1,
      subject: { offending_type: 'flask.Request', via: 'signature' },
      reason: 'Parameter req is typed flask.Request; the domain layer references a web framework.',
      suggestion: 'Accept a plain DTO; map the request in the api layer.',
      confidence: 0.8,
    },
  ],
})

const BASE_FILES: Record<string, string> = {
  'soll.ilograph.yaml': SOLL_YAML,
  'architecture-rules.yaml': RULES_YAML,
  'app/domain/pricing.py': 'def quote(amount: int) -> int:\n    return amount\n',
  'app/infra/db.py': 'def save(row: dict) -> None:\n    return None\n',
}

const CHANGED_PRICING = 'def quote(req: "flask.Request") -> int:\n    return 0\n'
/** Adds a forbidden domain → infra edge, so the rule-engine reports a violation as well. */
const CHANGED_PRICING_WITH_EDGE = `from app.infra.db import save\n\n\n${CHANGED_PRICING}`

function makeRepo(extraCommitted: Record<string, string> = {}, changed = CHANGED_PRICING): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-footer-'))
  repos.push(root)
  for (const [path, content] of Object.entries({ ...BASE_FILES, ...extraCommitted })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'baseline')
  writeFileSync(join(root, 'app/domain/pricing.py'), changed)
  return root
}

/** Replays `responses`; the last one repeats. `throwOnCall` makes call number N reject. */
function fakeLlm(responses: string[], throwOnCall?: number): LlmSetup {
  let calls = 0
  const client: LlmClient = {
    async complete() {
      calls++
      if (calls === throwOnCall) throw new Error('provider exploded')
      return {
        text: responses[Math.min(calls - 1, responses.length - 1)],
        model: 'fake-build',
        promptTokens: 7,
        completionTokens: 3,
      }
    },
  }
  return {
    client,
    options: { modelRequested: 'test/model', temperature: 0, seed: 42, maxRetries: 0 },
    baseUrl: 'https://provider.example/api/v1',
    seed: 42,
    temperature: 0,
  }
}

function readLog(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function runInput(repoRoot: string, logName: string, llm?: LlmSetup, runs = 1) {
  return {
    repoRoot,
    topologyPath: join(repoRoot, 'soll.ilograph.yaml'),
    rulesPath: join(repoRoot, 'architecture-rules.yaml'),
    base: 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff' as const,
    runLogPath: join(repoRoot, logName),
    runs,
    cliArgs: [],
    llm,
  }
}

describe('run_footer', () => {
  it('closes a clean run with status completed and exit code 0', async () => {
    const repo = makeRepo()
    const result = await runConformance(runInput(repo, 'log.jsonl', fakeLlm([CLEAN_RESPONSE])))
    const lines = readLog(join(repo, 'log.jsonl'))
    const footer = lines[lines.length - 1]

    expect(footer.record_type).toBe('run_footer') // the footer is the last line
    expect(footer.status).toBe('completed')
    expect(footer.invalid_reasons).toEqual([])
    expect(footer.exit_code).toBe(0)
    expect(footer.runs_requested).toBe(1)
    expect(footer.runs_completed).toBe(1)
    expect(footer.calls_total).toBe(1)
    expect(footer.calls_invalid).toBe(0)
    expect(footer.skipped_count).toBe(0)
    expect(footer.wall_clock_ms).toEqual(expect.any(Number))
    expect(footer.run_id).toBe(lines[0].run_id)
    expect(result.exitCode).toBe(0)
  })

  it('exits 3 and names the offending call when a response never validates', async () => {
    const repo = makeRepo()
    const result = await runConformance(runInput(repo, 'log.jsonl', fakeLlm(['not json'])))
    const footer = readLog(join(repo, 'log.jsonl')).at(-1)!

    expect(result.exitCode).toBe(3)
    expect(footer.exit_code).toBe(3)
    expect(footer.status).toBe('completed') // it ran to the end, it just is not trustworthy
    expect(footer.calls_invalid).toBe(1)
    expect(footer.invalid_calls).toEqual([{ file: 'app/domain/pricing.py', run_index: 0 }])
    expect(footer.invalid_reasons).toEqual(['invalid_final_response'])
  })

  it('lets 3 win over 1 when there are violations and an invalid call', async () => {
    const repo = makeRepo({}, CHANGED_PRICING_WITH_EDGE)
    const result = await runConformance(runInput(repo, 'log.jsonl', fakeLlm(['not json'])))
    const footer = readLog(join(repo, 'log.jsonl')).at(-1)!

    // The rule-engine did find something — without the invalid call this would be exit 1.
    expect(allViolations(result.results).some((v) => v.severity === 'error')).toBe(true)
    expect(result.exitCode).toBe(3)
    expect(footer.exit_code).toBe(3)
  })

  it('still writes a footer when a repetition throws, marked aborted with the runs it managed', async () => {
    const repo = makeRepo()
    // One file per repetition: call 3 is repetition 2.
    const llm = fakeLlm([CLEAN_RESPONSE], 3)

    await expect(runConformance(runInput(repo, 'log.jsonl', llm, 3))).rejects.toThrow('provider exploded')

    const lines = readLog(join(repo, 'log.jsonl'))
    const footer = lines.at(-1)!
    expect(footer.record_type).toBe('run_footer')
    expect(footer.status).toBe('aborted')
    expect(footer.runs_requested).toBe(3)
    expect(footer.runs_completed).toBe(2)
    expect(footer.exit_code).toBe(2)
    // The two repetitions that did complete are still in the log.
    expect(lines.filter((l) => l.record_type === 'llm_call')).toHaveLength(2)
  })

  it('exits 3 when a file could not be parsed', async () => {
    const repo = makeRepo({ 'app/infra/broken.py': 'def (:\n' })
    const result = await runConformance({
      ...runInput(repo, 'log.jsonl', fakeLlm([CLEAN_RESPONSE])),
      ruleGraph: 'full',
    })
    const footer = readLog(join(repo, 'log.jsonl')).at(-1)!

    expect(result.exitCode).toBe(3)
    expect(footer.skipped_count).toBe(1)
    expect(footer.invalid_reasons).toEqual(['skipped_files'])
    expect(footer.exit_code).toBe(3)
  })

  it('writes exactly one footer per invocation, paired with its header by run_id', async () => {
    const repo = makeRepo()
    await runConformance(runInput(repo, 'log.jsonl', fakeLlm([CLEAN_RESPONSE])))
    await runConformance(runInput(repo, 'log.jsonl', fakeLlm([CLEAN_RESPONSE])))
    const lines = readLog(join(repo, 'log.jsonl'))

    const headers = lines.filter((l) => l.record_type === 'run_header')
    const footers = lines.filter((l) => l.record_type === 'run_footer')
    expect(headers).toHaveLength(2)
    expect(footers).toHaveLength(2)
    expect(footers.map((f) => f.run_id)).toEqual(headers.map((h) => h.run_id))
    expect(new Set(footers.map((f) => f.run_id)).size).toBe(2)
  })
})
