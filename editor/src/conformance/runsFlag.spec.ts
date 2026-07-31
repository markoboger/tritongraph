/**
 * `--runs N`: repeat the LLM path N times inside one run_id so the eval harness can measure model
 * variance. The deterministic rule-engine must run exactly once no matter how many repetitions were
 * asked for — repeating it could only duplicate identical findings.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import { parseArgs } from '../../../packages/triton-conformance/src/cliArgs'
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

const VALID_RESPONSE = JSON.stringify({
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

const BASE_FILES = {
  'soll.ilograph.yaml': SOLL_YAML,
  'architecture-rules.yaml': RULES_YAML,
  'app/domain/pricing.py': 'def quote(amount: int) -> int:\n    return amount\n',
  'app/infra/db.py': 'def save(row: dict) -> None:\n    return None\n',
}

/** domain → infra is not an allowed edge, so the rule-engine reports exactly one violation. */
const LEAKY_PRICING = 'from app.infra.db import save\n\n\ndef quote(req: "flask.Request") -> int:\n    return 0\n'

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-runs-'))
  repos.push(root)
  for (const [path, content] of Object.entries(BASE_FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'baseline')
  writeFileSync(join(root, 'app/domain/pricing.py'), LEAKY_PRICING)
  return root
}

function fakeLlm(): { llm: LlmSetup; calls: () => number } {
  let calls = 0
  const client: LlmClient = {
    async complete() {
      calls++
      return { text: VALID_RESPONSE, model: 'fake-model-build-7', promptTokens: 11, completionTokens: 5 }
    },
  }
  return {
    llm: {
      client,
      options: { modelRequested: 'test/model', temperature: 0, seed: 42 },
      baseUrl: 'https://provider.example/api/v1',
      seed: 42,
      temperature: 0,
    },
    calls: () => calls,
  }
}

function readLog(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function run(repoRoot: string, runs: number, llm: LlmSetup) {
  const logPath = join(repoRoot, 'run-log.jsonl')
  const result = await runConformance({
    repoRoot,
    topologyPath: join(repoRoot, 'soll.ilograph.yaml'),
    rulesPath: join(repoRoot, 'architecture-rules.yaml'),
    base: 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff',
    runLogPath: logPath,
    runs,
    cliArgs: ['--runs', String(runs)],
    llm,
  })
  return { result, lines: readLog(logPath) }
}

describe('--runs N', () => {
  it('writes one header and N call lines per file, numbered 0..N-1 under one run_id', async () => {
    const repo = makeRepo()
    const { lines } = await run(repo, 3, fakeLlm().llm)

    const headers = lines.filter((l) => l.record_type === 'run_header')
    const calls = lines.filter((l) => l.record_type === 'llm_call')
    expect(headers).toHaveLength(1)
    expect(headers[0].runs_requested).toBe(3)
    // One changed file × 3 repetitions.
    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.run_index)).toEqual([0, 1, 2])
    expect(calls.every((c) => c.file === 'app/domain/pricing.py')).toBe(true)
    expect(calls.every((c) => c.run_id === headers[0].run_id)).toBe(true)
  })

  it('calls the model once per repetition but runs the rule-engine only once', async () => {
    const repo = makeRepo()
    const { llm, calls } = fakeLlm()
    const { result } = await run(repo, 3, llm)

    expect(calls()).toBe(3) // one changed file, three repetitions
    // The rule-engine ran once: its forbidden-edge finding appears exactly once in the results,
    // and repetitions are not merged into them.
    const structural = allViolations(result.results).filter((v) => v.source === 'rule-engine')
    expect(structural).toHaveLength(1)
    expect(structural[0].rule_id).toBe('DERIVED:forbidden-edge')
    expect(allViolations(result.results).filter((v) => v.source === 'llm')).toHaveLength(1)
  })

  it('defaults to a single repetition', async () => {
    const repo = makeRepo()
    const { lines } = await run(repo, 1, fakeLlm().llm)
    const calls = lines.filter((l) => l.record_type === 'llm_call')

    expect(calls).toHaveLength(1)
    expect(calls[0].run_index).toBe(0)
  })
})

describe('--runs argument validation', () => {
  const base = ['--topology', 'soll.yaml', '--rules', 'rules.yaml']

  it('accepts a positive integer and defaults to 1', () => {
    expect(parseArgs([...base, '--runs', '5']).runs).toBe(5)
    expect(parseArgs(base).runs).toBe(1)
  })

  it('rejects 0 and non-numeric values with the usage line', () => {
    expect(() => parseArgs([...base, '--runs', '0'])).toThrow(/--runs must be an integer >= 1, got '0'/)
    expect(() => parseArgs([...base, '--runs', '0'])).toThrow(/usage: triton-conformance/)
    expect(() => parseArgs([...base, '--runs', 'abc'])).toThrow(/--runs must be an integer >= 1, got 'abc'/)
    expect(() => parseArgs([...base, '--runs', '2.5'])).toThrow(/--runs must be an integer >= 1/)
  })
})
