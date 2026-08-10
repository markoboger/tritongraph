// @vitest-environment node
/**
 * Provider pin and provenance: which backend a run asked for (run header) and which one answered
 * (llm_call record). The request body is asserted against a mocked `fetch`, the log against full
 * runs with an injected fake client — no network, no paid call.
 *
 * The important guard is the unpinned case: the local arm of the measurement runs against Ollama,
 * whose handling of an unknown `provider` field is not established, so the key must be absent from
 * the body rather than sent as null.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import {
  VIOLATIONS_SCHEMA,
  createOpenAiClient,
  type LlmClient,
} from '../../../packages/triton-conformance/src/llmClient'

const repos: string[] = []
afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
afterEach(() => vi.unstubAllGlobals())

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

const BASE_FILES: Record<string, string> = {
  'soll.ilograph.yaml': SOLL_YAML,
  'architecture-rules.yaml': RULES_YAML,
  'app/domain/pricing.py': 'def quote(amount: int) -> int:\n    return amount\n',
}

const LEAKY_PRICING = 'def quote(req: "flask.Request") -> int:\n    return 0\n'
const CLEAN_RESPONSE = JSON.stringify({ violations: [] })

/** Git repo with a committed baseline; the leaky file is written after the commit, so it diffs. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-providerpin-'))
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

/** Captures the JSON body of the single request the client sends, and answers it OpenAI-style. */
function stubFetch(responseBody: Record<string, unknown>): () => Record<string, unknown> {
  let sent: Record<string, unknown> = {}
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body) as Record<string, unknown>
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => responseBody,
    }
  })
  return () => sent
}

const OPENAI_BODY = {
  model: 'example/test-model',
  choices: [{ message: { content: CLEAN_RESPONSE } }],
  usage: { prompt_tokens: 11, completion_tokens: 5 },
}

async function callWith(providerPin?: string): Promise<Record<string, unknown>> {
  const sentBody = stubFetch(OPENAI_BODY)
  const client = createOpenAiClient({
    baseUrl: 'https://openrouter.example/api/v1',
    apiKey: 'test-key',
    model: 'example/test-model',
    providerPin,
  })
  await client.complete({
    messages: [{ role: 'user', content: 'hi' }],
    schema: VIOLATIONS_SCHEMA as unknown as object,
    schemaName: 'conformance_violations',
  })
  return sentBody()
}

/** Fake client for full runs; `provider` is omitted entirely when null, as Ollama does. */
function fakeLlm(provider: string | null, providerPin?: string): LlmSetup {
  const client: LlmClient = {
    async complete() {
      return {
        text: CLEAN_RESPONSE,
        model: 'fake-model-build-7',
        promptTokens: 11,
        completionTokens: 5,
        ...(provider === null ? {} : { provider }),
      }
    },
  }
  return {
    client,
    options: { modelRequested: 'test/model', temperature: 0, seed: 42 },
    baseUrl: 'https://provider.example/api/v1',
    seed: 42,
    temperature: 0,
    providerPin,
  }
}

async function runAndReadLog(llm: LlmSetup): Promise<Record<string, unknown>[]> {
  const repo = makeRepo()
  const logPath = join(repo, 'run-log.jsonl')
  await runConformance({
    repoRoot: repo,
    topologyPath: join(repo, 'soll.ilograph.yaml'),
    rulesPath: join(repo, 'architecture-rules.yaml'),
    base: 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff',
    runLogPath: logPath,
    cliArgs: ['--topology', 'soll.ilograph.yaml', '--rules', 'architecture-rules.yaml'],
    llm,
  })
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('provider pin in the request body', () => {
  it('sends the pin without fallbacks when one is configured', async () => {
    expect((await callWith('digitalocean')).provider).toEqual({
      order: ['digitalocean'],
      allow_fallbacks: false,
    })
  })

  it('omits the provider key entirely when no pin is configured', async () => {
    const body = await callWith(undefined)
    expect(body).not.toHaveProperty('provider')
    expect(Object.keys(body)).toEqual(['model', 'messages', 'temperature', 'seed', 'response_format'])
  })
})

describe('provider provenance in the run log', () => {
  it('records the serving backend as provider_served', async () => {
    const call = (await runAndReadLog(fakeLlm('DigitalOcean')))[1]
    expect(call.provider_served).toBe('DigitalOcean')
  })

  it('logs provider_served as null when the provider reports none, and runs through', async () => {
    const lines = await runAndReadLog(fakeLlm(null))
    const [, call, footer] = lines
    expect(call).toHaveProperty('provider_served', null)
    expect(call.valid_final).toBe(true)
    expect(footer.status).toBe('completed')
  })

  it('records the requested pin in the header, and null when none was requested', async () => {
    const pinned = (await runAndReadLog(fakeLlm('DigitalOcean', 'digitalocean')))[0]
    expect(pinned.provider_pin).toEqual({ order: ['digitalocean'], allow_fallbacks: false })

    const unpinned = (await runAndReadLog(fakeLlm(null)))[0]
    expect(unpinned).toHaveProperty('provider_pin', null)
  })
})
