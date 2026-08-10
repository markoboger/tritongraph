/**
 * Run-log schema v2: the properties an eval harness relies on when it joins these records —
 * run-scoped identity (run_id), the prompt freeze hash, an honest model_version, per-attempt raw
 * text, and a file identity that is carried, not guessed.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import { llmCallRecords, sha256Text } from '../../../packages/triton-conformance/src/runLog'
import { SYSTEM_PROMPT } from '../../../packages/triton-conformance/src/contextBuilder'
import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'
import type { ChangedFact, CheckResult, RunLog } from '../../../packages/triton-conformance/src/types'

const repos: string[] = []
afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const SOLL_YAML = `
resources:
  - id: domain
    children: [{ id: app.domain.pricing }]
  - id: api
    children: [{ id: app.api.routes }]
perspectives:
  - name: dependencies
    relations:
      - { from: api, to: domain }
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
}

const LEAKY_PRICING = 'def quote(req: "flask.Request") -> int:\n    return 0\n'

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-schema2-'))
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

/** `model: ''` mimics a provider that reports no build at all. */
function fakeLlm(responses: string[], model = 'fake-model-build-7'): LlmSetup {
  let calls = 0
  const client: LlmClient = {
    async complete() {
      const text = responses[Math.min(calls, responses.length - 1)]
      calls++
      return { text, model, promptTokens: 11, completionTokens: 5 }
    },
  }
  return {
    client,
    options: { modelRequested: 'test/model', temperature: 0, seed: 42 },
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

async function run(repoRoot: string, llm: LlmSetup | undefined, logName = 'run-log.jsonl'): Promise<string> {
  const logPath = join(repoRoot, logName)
  await runConformance({
    repoRoot,
    topologyPath: join(repoRoot, 'soll.ilograph.yaml'),
    rulesPath: join(repoRoot, 'architecture-rules.yaml'),
    base: 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff',
    runLogPath: logPath,
    cliArgs: [],
    llm,
  })
  return logPath
}

describe('run log schema v2', () => {
  it('stamps every line of one invocation with the same run_id, and a new one per invocation', async () => {
    const repo = makeRepo()
    const lines = readLog(await run(repo, fakeLlm([VALID_RESPONSE])))
    const runId = lines[0].run_id as string

    expect(runId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/)
    expect(lines.every((line) => line.run_id === runId)).toBe(true)

    const second = readLog(await run(repo, fakeLlm([VALID_RESPONSE]), 'second.jsonl'))
    expect(second[0].run_id).not.toBe(runId)
    expect(second.every((line) => line.run_id === second[0].run_id)).toBe(true)
  })

  it('freezes the prompt template with a hash that follows the template content', async () => {
    const repo = makeRepo()
    const header = readLog(await run(repo, fakeLlm([VALID_RESPONSE])))[0]

    expect(header.prompt_template_sha256).toBe(sha256Text(SYSTEM_PROMPT))
    expect(header.prompt_template_sha256).toMatch(/^[0-9a-f]{64}$/)
    // Literal pin of the frozen system prompt: if this breaks, SYSTEM_PROMPT was edited.
    expect(sha256Text(SYSTEM_PROMPT)).toBe('65e78f38e7b1fee20000ea70c654df042f5e0831fc6a68ccb340f833bd915035')
    // The hash tracks the content: a template edit is a different hash.
    expect(sha256Text(SYSTEM_PROMPT)).not.toBe(sha256Text(`${SYSTEM_PROMPT} edited`))
  })

  it('logs model_version as null when the provider reports no build', async () => {
    const repo = makeRepo()
    const call = readLog(await run(repo, fakeLlm([VALID_RESPONSE], '')))[1]

    expect(call.model_version).toBeNull()
    expect(call.model_version).not.toBe('')
    expect(call.model_requested).toBe('test/model')
  })

  it('keeps the discarded raw text of an invalid attempt next to the accepted one', async () => {
    const repo = makeRepo()
    const call = readLog(await run(repo, fakeLlm(['{"violations": "not an array"}', VALID_RESPONSE])))[1]
    const attempts = call.attempts as { raw_response: string; valid: boolean }[]

    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toMatchObject({ raw_response: '{"violations": "not an array"}', valid: false })
    expect(attempts[1]).toMatchObject({ raw_response: VALID_RESPONSE, valid: true })
    expect(call.raw_response).toBe(VALID_RESPONSE) // aggregate keeps the last one
  })
})

describe('llmCallRecords pairing invariant', () => {
  const fact: ChangedFact = {
    path: 'app/domain/pricing.py',
    module: 'app.domain.pricing',
    component: 'domain',
    diff_kind: 'modified',
    imports: [],
    signatures: [],
  }
  const runLog: RunLog = {
    model_requested: 'test/model',
    model_version: 'build-1',
    model_version_reported: 'build-1',
    attempts: [],
    temperature: 0,
    seed: 42,
    run_index: 0,
    tokens: { prompt: 1, completion: 1 },
    latency_ms: 1,
    valid_raw: true,
    valid_final: true,
    outcome: 'measured',
    transport_failures: [],
    retries: 0,
    prompt_hash: 'deadbeef',
    raw_response: '{}',
  }
  const result = (file: string | undefined): CheckResult => ({
    file,
    violations: [],
    checks_performed: [],
    run: runLog,
  })

  it('pairs a result with its fact by the carried file identity', () => {
    const records = llmCallRecords('run-1', [fact], [result(fact.path)])
    expect(records).toHaveLength(1)
    expect(records[0].file).toBe(fact.path)
    expect(records[0].run_id).toBe('run-1')
  })

  it('aborts when a result cannot be matched to a fact instead of logging a guess', () => {
    expect(() => llmCallRecords('run-1', [fact], [result('app/other.py')])).toThrow(
      /no matching changed fact/,
    )
    expect(() => llmCallRecords('run-1', [fact], [result(undefined)])).toThrow(/no matching changed fact/)
  })

  it('aborts when two results claim the same file', () => {
    expect(() => llmCallRecords('run-1', [fact], [result(fact.path), result(fact.path)])).toThrow(
      /two check results claim the same file/,
    )
  })
})
