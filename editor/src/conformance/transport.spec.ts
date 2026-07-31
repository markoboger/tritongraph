// @vitest-environment node
/**
 * Timeout and transport-error handling: a call that never reached the model must not look like a
 * model that answered badly. These tests drive full runs (real git repo, real python3 extraction)
 * and, where the AbortController itself is under test, a real HTTP server on localhost.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import { parseArgs } from '../../../packages/triton-conformance/src/cliArgs'
import {
  TransportError,
  createOpenAiClient,
  type LlmClient,
} from '../../../packages/triton-conformance/src/llmClient'

const repos: string[] = []
const servers: Server[] = []
afterAll(() => {
  repos.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  servers.forEach((server) => server.close())
})

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

const CLEAN_RESPONSE = JSON.stringify({ violations: [] })
const LEAKY = 'def quote(req: "flask.Request") -> int:\n    return 0\n'

const BASE_FILES: Record<string, string> = {
  'soll.ilograph.yaml': SOLL_YAML,
  'architecture-rules.yaml': RULES_YAML,
  'app/domain/pricing.py': 'def quote(amount: int) -> int:\n    return amount\n',
  'app/domain/order.py': 'def place(id: int) -> None:\n    return None\n',
}

/** Git repo with a committed baseline; `changed` is written afterwards, so it shows in the diff. */
function makeRepo(changed: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-transport-'))
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
  for (const [path, content] of Object.entries(changed)) writeFileSync(join(root, path), content)
  return root
}

/** OpenAI-compatible stub on a free port; `handler` decides what each request gets. */
async function startStub(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('stub server has no port')
  return `http://127.0.0.1:${address.port}/v1`
}

function sendCompletion(res: ServerResponse, content = CLEAN_RESPONSE): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      model: 'stub-build-1',
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }),
  )
}

function setup(client: LlmClient, backoff: readonly number[] = [10, 10]): LlmSetup {
  return {
    client,
    options: { modelRequested: 'test/model', temperature: 0, seed: 42, maxRetries: 0, transportBackoffMs: backoff },
    baseUrl: 'https://provider.example/api/v1',
    seed: 42,
    temperature: 0,
  }
}

function realSetup(baseUrl: string, timeoutMs: number, backoff: readonly number[] = [10, 10]): LlmSetup {
  return {
    client: createOpenAiClient({ baseUrl, apiKey: 'stub', model: 'stub/model', timeoutMs }),
    options: { modelRequested: 'stub/model', temperature: 0, seed: 42, maxRetries: 0, transportBackoffMs: backoff },
    baseUrl,
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

function runInput(repoRoot: string, llm: LlmSetup, runs = 1) {
  return {
    repoRoot,
    topologyPath: join(repoRoot, 'soll.ilograph.yaml'),
    rulesPath: join(repoRoot, 'architecture-rules.yaml'),
    base: 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff' as const,
    runLogPath: join(repoRoot, 'log.jsonl'),
    runs,
    cliArgs: [],
    llm,
  }
}

describe('transport errors', () => {
  it('times out a provider that never answers and reports the call as not measured', async () => {
    // Accepts the connection and then says nothing at all — only the timeout can end this.
    const baseUrl = await startStub(() => {})
    const repo = makeRepo({ 'app/domain/pricing.py': LEAKY })

    const result = await runConformance(runInput(repo, realSetup(baseUrl, 300)))
    const lines = readLog(join(repo, 'log.jsonl'))
    const call = lines.find((l) => l.record_type === 'llm_call')!
    const footer = lines.at(-1)!

    expect(call.outcome).toBe('transport_failed')
    expect(call.valid_final).toBeNull() // never false: the model was never asked
    expect(call.valid_raw).toBeNull()
    expect(call.attempts).toEqual([])
    expect((call.transport_failures as { kind: string }[]).map((f) => f.kind)).toEqual([
      'timeout',
      'timeout',
      'timeout',
    ])
    expect(result.exitCode).toBe(3)
    expect(footer.invalid_reasons).toEqual(['transport_failure'])
    expect(footer.calls_transport_failed).toBe(1)
    expect(footer.calls_invalid).toBe(0)
    expect(footer.failed_calls).toEqual([{ file: 'app/domain/pricing.py', run_index: 0 }])
  }, 15000)

  it('keeps a call that only succeeded on the third try out of the unsound bucket', async () => {
    let calls = 0
    const client: LlmClient = {
      async complete() {
        calls++
        if (calls <= 2) throw new TransportError('http_5xx', 503, null, 'upstream down')
        return { text: CLEAN_RESPONSE, model: 'fake-build', promptTokens: 7, completionTokens: 3 }
      },
    }
    const repo = makeRepo({ 'app/domain/pricing.py': LEAKY })

    const result = await runConformance(runInput(repo, setup(client)))
    const lines = readLog(join(repo, 'log.jsonl'))
    const call = lines.find((l) => l.record_type === 'llm_call')!
    const footer = lines.at(-1)!

    expect(call.outcome).toBe('measured')
    expect(call.valid_final).toBe(true)
    expect(call.transport_failures).toEqual([
      { kind: 'http_5xx', http_status: 503, latency_ms: expect.any(Number), try_index: 0 },
      { kind: 'http_5xx', http_status: 503, latency_ms: expect.any(Number), try_index: 1 },
    ])
    expect(footer.calls_with_transport_retry).toBe(1)
    expect(footer.calls_transport_failed).toBe(0)
    expect(footer.invalid_reasons).toEqual([])
    expect(result.exitCode).toBe(0) // a retry that worked is cost, not a measurement error
  })

  it('waits out a 429 Retry-After instead of its own backoff', async () => {
    let calls = 0
    const baseUrl = await startStub((_req, res) => {
      calls++
      if (calls === 1) {
        res.writeHead(429, { 'Retry-After': '1' })
        res.end('slow down')
        return
      }
      sendCompletion(res)
    })
    const repo = makeRepo({ 'app/domain/pricing.py': LEAKY })

    const startedAt = Date.now()
    // Own backoff is 10 ms, so anything past a second can only come from the Retry-After header.
    const result = await runConformance(runInput(repo, realSetup(baseUrl, 5000, [10, 10])))
    const elapsed = Date.now() - startedAt
    const call = readLog(join(repo, 'log.jsonl')).find((l) => l.record_type === 'llm_call')!

    expect(calls).toBe(2)
    expect(elapsed).toBeGreaterThanOrEqual(1000)
    expect(call.transport_failures).toEqual([
      { kind: 'http_429', http_status: 429, latency_ms: expect.any(Number), try_index: 0 },
    ])
    expect(call.outcome).toBe('measured')
    expect(result.exitCode).toBe(0)
  }, 15000)

  it('counts an invalid answer and a lost call as two separate reasons', async () => {
    // The prompt names the file, so the stub can treat the two changed files differently.
    const client: LlmClient = {
      async complete(request) {
        const prompt = JSON.stringify(request.messages)
        if (prompt.includes('app/domain/order.py')) throw new TransportError('network', null, null, 'socket closed')
        return { text: 'not json', model: 'fake-build', promptTokens: 7, completionTokens: 3 }
      },
    }
    const repo = makeRepo({ 'app/domain/pricing.py': LEAKY, 'app/domain/order.py': LEAKY })

    const result = await runConformance(runInput(repo, setup(client, [])))
    const footer = readLog(join(repo, 'log.jsonl')).at(-1)!

    expect(footer.calls_total).toBe(2)
    expect(footer.calls_invalid).toBe(1)
    expect(footer.invalid_calls).toEqual([{ file: 'app/domain/pricing.py', run_index: 0 }])
    expect(footer.calls_transport_failed).toBe(1)
    expect(footer.failed_calls).toEqual([{ file: 'app/domain/order.py', run_index: 0 }])
    expect(footer.invalid_reasons).toEqual(['invalid_final_response', 'transport_failure'])
    expect(result.exitCode).toBe(3)
  })

  it('gives up on a provider after five consecutive lost calls, aborted but with exit code 3', async () => {
    const client: LlmClient = {
      complete: () => Promise.reject(new TransportError('network', null, null, 'connection refused')),
    }
    const repo = makeRepo({ 'app/domain/pricing.py': LEAKY })

    const result = await runConformance(runInput(repo, setup(client, []), 6))
    const lines = readLog(join(repo, 'log.jsonl'))
    const footer = lines.at(-1)!

    expect(footer.record_type).toBe('run_footer')
    expect(footer.status).toBe('aborted')
    expect(footer.exit_code).toBe(3) // an outage is not a program error, so never 2
    expect(result.exitCode).toBe(3)
    expect(footer.runs_requested).toBe(6)
    expect(footer.runs_completed).toBe(5)
    expect(footer.calls_transport_failed).toBe(5)
    expect(lines.filter((l) => l.record_type === 'llm_call')).toHaveLength(5)
  })

  it('does not fire the timeout on a provider that answers inside the budget', async () => {
    const baseUrl = await startStub((_req, res) => setTimeout(() => sendCompletion(res), 100))
    const repo = makeRepo({ 'app/domain/pricing.py': LEAKY })

    const result = await runConformance(runInput(repo, realSetup(baseUrl, 500)))
    const call = readLog(join(repo, 'log.jsonl')).find((l) => l.record_type === 'llm_call')!

    expect(call.outcome).toBe('measured')
    expect(call.transport_failures).toEqual([])
    expect(call.valid_final).toBe(true)
    expect(result.exitCode).toBe(0)
  }, 15000)

  it('rejects a --timeout-ms that would measure the network instead of the model', () => {
    const base = ['--topology', 't.yaml', '--rules', 'r.yaml']
    expect(() => parseArgs([...base, '--timeout-ms', '0'])).toThrow(/--timeout-ms must be an integer >= 1000/)
    expect(() => parseArgs([...base, '--timeout-ms', 'abc'])).toThrow(/--timeout-ms must be an integer >= 1000/)
    expect(parseArgs(base).timeoutMs).toBe(120000) // the documented default
  })
})
