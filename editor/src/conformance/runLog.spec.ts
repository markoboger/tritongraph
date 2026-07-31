/**
 * The JSONL run log (`--run-log`): the raw measurement data an eval harness later joins against.
 * Drives full runs through runConformance with an injected fake LLM client — real git repo, real
 * python3 extraction, no network — and asserts on the file that ends up on disk.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'

const repos: string[] = []
afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const SOLL_YAML = `
resources:
  - id: domain
    children: [{ id: app.domain.pricing }, { id: app.domain.order }]
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

/** A git repo with a committed baseline; `changed` is written afterwards, so it shows in the diff. */
function makeRepo(committed: Record<string, string>, changed: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-runlog-'))
  repos.push(root)
  writeFiles(root, committed)
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'baseline')
  writeFiles(root, changed)
  return root
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

const BASE_FILES = {
  'soll.ilograph.yaml': SOLL_YAML,
  'architecture-rules.yaml': RULES_YAML,
  'app/domain/pricing.py': 'def quote(amount: int) -> int:\n    return amount\n',
}

const LEAKY_PRICING = 'def quote(req: "flask.Request") -> int:\n    return 0\n'

/** Fake client replaying canned responses; the last one repeats once the list runs out. */
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

async function run(
  repoRoot: string,
  overrides: Partial<Parameters<typeof runConformance>[0]> = {},
): Promise<string> {
  const logPath = join(repoRoot, 'run-log.jsonl')
  await runConformance({
    repoRoot,
    topologyPath: join(repoRoot, 'soll.ilograph.yaml'),
    rulesPath: join(repoRoot, 'architecture-rules.yaml'),
    base: 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff',
    runLogPath: logPath,
    cliArgs: ['--topology', 'soll.ilograph.yaml', '--rules', 'architecture-rules.yaml'],
    ...overrides,
  })
  return logPath
}

const HEADER_FIELDS = [
  'record_type',
  'log_schema_version',
  'run_id',
  'timestamp',
  'cli_args',
  'rule_graph_mode',
  'topology_path',
  'topology_sha256',
  'rules_path',
  'rules_sha256',
  'prompt_template_sha256',
  'target_repo_git_head',
  'checker_git_head',
  'base_ref',
  'src_roots',
  'model_requested',
  'endpoint',
  'seed_requested',
  'temperature_requested',
  'changed_files_count',
  'graph_files_count',
  'skipped',
]

const CALL_FIELDS = [
  'record_type',
  'run_id',
  'timestamp',
  'file',
  'module',
  'model_requested',
  'model_version',
  'attempts',
  'attempts_used',
  'valid_raw',
  'valid_final',
  'tokens_in_total',
  'tokens_out_total',
  'latency_ms_total',
  'temperature_requested',
  'seed_requested',
  'run_index',
  'tokens',
  'latency_ms',
  'retries',
  'prompt_hash',
  'raw_response',
]

describe('run log', () => {
  it('writes one header and one llm_call line, each carrying every schema field', async () => {
    const repo = makeRepo(BASE_FILES, { 'app/domain/pricing.py': LEAKY_PRICING })
    const lines = readLog(await run(repo, { llm: fakeLlm([VALID_RESPONSE]) }))

    expect(lines).toHaveLength(2)
    const [header, call] = lines
    // Presence, not truthiness — a null endpoint is data, a missing endpoint is a hole.
    expect(Object.keys(header)).toEqual(expect.arrayContaining(HEADER_FIELDS))
    expect(Object.keys(call)).toEqual(expect.arrayContaining(CALL_FIELDS))

    expect(header.record_type).toBe('run_header')
    expect(header.log_schema_version).toBe('2')
    expect(header.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(header.endpoint).toBe('https://provider.example/api/v1')
    expect(header.seed_requested).toBe(42)
    expect(header.temperature_requested).toBe(0)
    expect(header.model_requested).toBe('test/model')
    expect(header.target_repo_git_head).toMatch(/^[0-9a-f]{40}$/)
    expect(header.changed_files_count).toBe(1)

    expect(call.record_type).toBe('llm_call')
    expect(call.file).toBe('app/domain/pricing.py')
    expect(call.module).toBe('app.domain.pricing')
    expect(call.model_version).toBe('fake-model-build-7')
    expect(call.attempts).toEqual([
      {
        attempt_index: 0,
        tokens_in: 11,
        tokens_out: 5,
        latency_ms: expect.any(Number),
        valid: true,
        raw_response: VALID_RESPONSE,
      },
    ])
    expect(call.attempts_used).toBe(1)
    expect(call.tokens_in_total).toBe(11)
    expect(call.tokens_out_total).toBe(5)
  })

  it('logs every attempt of a retry, with attempt_index, validity and the raw/final split', async () => {
    const repo = makeRepo(BASE_FILES, { 'app/domain/pricing.py': LEAKY_PRICING })
    const lines = readLog(await run(repo, { llm: fakeLlm(['not json at all', VALID_RESPONSE]) }))

    const call = lines[1]
    expect(call.attempts).toEqual([
      {
        attempt_index: 0,
        tokens_in: 11,
        tokens_out: 5,
        latency_ms: expect.any(Number),
        valid: false,
        raw_response: 'not json at all',
      },
      {
        attempt_index: 1,
        tokens_in: 11,
        tokens_out: 5,
        latency_ms: expect.any(Number),
        valid: true,
        raw_response: VALID_RESPONSE,
      },
    ])
    expect(call.attempts_used).toBe(2)
    expect(call.valid_raw).toBe(false)
    expect(call.valid_final).toBe(true)
    expect(call.tokens_in_total).toBe(22)
  })

  it('hashes topology and rules so a changed Soll is visible in the header', async () => {
    const repo = makeRepo(BASE_FILES, { 'app/domain/pricing.py': LEAKY_PRICING })
    const first = readLog(await run(repo))[0]
    expect(first.topology_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(first.rules_sha256).toMatch(/^[0-9a-f]{64}$/)

    writeFiles(repo, {
      'soll.ilograph.yaml': `${SOLL_YAML}# edited\n`,
      'architecture-rules.yaml': `${RULES_YAML}# edited\n`,
    })
    rmSync(join(repo, 'run-log.jsonl'))
    const second = readLog(await run(repo))[0]

    expect(second.topology_sha256).not.toBe(first.topology_sha256)
    expect(second.rules_sha256).not.toBe(first.rules_sha256)
  })

  it('records an unparseable file in the header instead of losing it', async () => {
    const repo = makeRepo(
      { ...BASE_FILES, 'app/domain/order.py': 'def (:\n' },
      { 'app/domain/pricing.py': LEAKY_PRICING },
    )
    const header = readLog(await run(repo, { ruleGraph: 'full' }))[0]

    expect(header.skipped).toEqual([
      { path: 'app/domain/order.py', reason: expect.stringContaining('SyntaxError') },
    ])
  })

  it('aborts before any model call when the log path is not writable', async () => {
    const repo = makeRepo(BASE_FILES, { 'app/domain/pricing.py': LEAKY_PRICING })
    const llm = fakeLlm([VALID_RESPONSE])
    llm.client = {
      complete: () => Promise.reject(new Error('the model must not be called on an unwritable log')),
    }

    await expect(run(repo, { runLogPath: join(repo, 'no-such-dir', 'log.jsonl'), llm })).rejects.toThrow(
      /cannot write run log at/,
    )
  })

  it('appends across invocations instead of overwriting the log', async () => {
    const repo = makeRepo(BASE_FILES, { 'app/domain/pricing.py': LEAKY_PRICING })
    await run(repo, { llm: fakeLlm([VALID_RESPONSE]) })
    const lines = readLog(await run(repo, { llm: fakeLlm([VALID_RESPONSE]) }))

    expect(lines).toHaveLength(4)
    expect(lines.filter((l) => l.record_type === 'run_header')).toHaveLength(2)
    expect(lines.filter((l) => l.record_type === 'llm_call')).toHaveLength(2)
  })
})
