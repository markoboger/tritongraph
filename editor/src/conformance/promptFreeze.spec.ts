/**
 * Prompt freeze: the run log must pin what was actually sent to the model. The system prompt is a
 * constant and hashed directly; the user prompt is assembled by code, so it is pinned by hashing
 * its render of a frozen canary input.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import { buildUserPrompt } from '../../../packages/triton-conformance/src/contextBuilder'
import { CANARY_CONTEXT } from '../../../packages/triton-conformance/src/promptCanary'
import { sha256Text } from '../../../packages/triton-conformance/src/runLog'
import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'

const repos: string[] = []
afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const BASE_FILES: Record<string, string> = {
  'soll.ilograph.yaml': `
resources:
  - id: domain
    children: [{ id: app.domain.pricing }]
  - id: api
    children: [{ id: app.api.routes }]
perspectives:
  - name: dependencies
    relations:
      - { from: api, to: domain }
`,
  'architecture-rules.yaml': `
rules:
  - id: no-domain-framework-coupling
    category: semantic-framework-leak
    kind: semantic
    scope: { components: [domain] }
    statement: Domain logic must not reference framework concepts.
    severity: error
`,
  'app/domain/pricing.py': 'def quote(amount: int) -> int:\n    return amount\n',
}

const VALID_RESPONSE = JSON.stringify({ violations: [] })

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-freeze-'))
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
  writeFileSync(join(root, 'app/domain/pricing.py'), 'def quote(req: "flask.Request") -> int:\n    return 0\n')
  return root
}

const llm: LlmSetup = {
  client: {
    async complete() {
      return { text: VALID_RESPONSE, model: 'fake-build', promptTokens: 1, completionTokens: 1 }
    },
  } as LlmClient,
  options: { modelRequested: 'test/model', temperature: 0, seed: 42 },
  baseUrl: 'https://provider.example/api/v1',
  seed: 42,
  temperature: 0,
}

async function header(repoRoot: string, logName: string): Promise<Record<string, unknown>> {
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
  return JSON.parse(readFileSync(logPath, 'utf8').split('\n')[0]) as Record<string, unknown>
}

describe('user_prompt_render_sha256', () => {
  it('is present in the header as 64 hex characters', async () => {
    const first = await header(makeRepo(), 'run-log.jsonl')

    expect(first.user_prompt_render_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(first.user_prompt_render_sha256).toBe(sha256Text(buildUserPrompt(CANARY_CONTEXT)))
  })

  it('is stable across invocations — the render is deterministic', async () => {
    const repo = makeRepo()
    const first = await header(repo, 'first.jsonl')
    const second = await header(repo, 'second.jsonl')

    expect(second.user_prompt_render_sha256).toBe(first.user_prompt_render_sha256)
    // Same input, rendered twice in-process: byte-identical.
    expect(buildUserPrompt(CANARY_CONTEXT)).toBe(buildUserPrompt(CANARY_CONTEXT))
  })

  it('changes when the rendered prompt changes', () => {
    const rendered = buildUserPrompt(CANARY_CONTEXT)
    // A minimally different input renders differently, so the hash moves with the prompt shape.
    const altered = buildUserPrompt({
      ...CANARY_CONTEXT,
      fact: { ...CANARY_CONTEXT.fact, module: 'canary.module_v2' },
    })

    expect(altered).not.toBe(rendered)
    expect(sha256Text(altered)).not.toBe(sha256Text(rendered))
  })

  it('exercises every section of the user prompt with the canary input', () => {
    const rendered = buildUserPrompt(CANARY_CONTEXT)

    expect(rendered).toContain('# Changed file')
    expect(rendered).toContain('## Imports')
    expect(rendered).toContain('- canary.target (component: canary_target)')
    expect(rendered).toContain('## Signatures')
    expect(rendered).toContain('- function canary_function(value: int) -> str')
    expect(rendered).toContain('## Allowed dependency edges touching this component')
    expect(rendered).toContain('- canary_component -> canary_target')
    expect(rendered).toContain('## Rules to check (scope includes this component)')
    expect(rendered).toContain('- id: canary-rule [semantic, error] (canary-category)')
  })
})
