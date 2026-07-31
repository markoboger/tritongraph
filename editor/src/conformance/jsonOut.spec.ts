/**
 * `--json-out`: the document the eval harness computes precision and recall from. What matters here
 * is that nothing is aggregated away — every repetition, every duplicate match_key, every performed
 * check survives verbatim, and the join keys against the run log line up.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import { buildMatchKey } from '../../../packages/triton-conformance/src/matchKey'
import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'
import type { ConformanceResultDocument } from '../../../packages/triton-conformance/src/jsonOut'

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

function llmViolation(offendingType: string, symbol = 'quote'): unknown {
  return {
    rule_id: 'no-domain-framework-coupling',
    symbol,
    line: 4,
    subject: { offending_type: offendingType, via: 'signature' },
    reason: `Parameter req is typed ${offendingType}; the domain layer references a web framework.`,
    suggestion: 'Accept a plain DTO; map the request in the api layer.',
    confidence: 0.8,
  }
}

const RESPONSE_FLASK = JSON.stringify({ violations: [llmViolation('flask.Request')] })
const RESPONSE_DJANGO = JSON.stringify({ violations: [llmViolation('django.http.HttpRequest')] })
/** Same subject twice under different symbols — the match_key is identical for both. */
const RESPONSE_DUPLICATE = JSON.stringify({
  violations: [llmViolation('flask.Request', 'quote'), llmViolation('flask.Request', 'discount')],
})

const BASE_FILES: Record<string, string> = {
  'soll.ilograph.yaml': SOLL_YAML,
  'architecture-rules.yaml': RULES_YAML,
  'app/domain/pricing.py': 'def quote(amount: int) -> int:\n    return amount\n',
  'app/infra/db.py': 'def save(row: dict) -> None:\n    return None\n',
}

/** Adds a forbidden domain → infra edge, so the rule-engine reports a finding of its own. */
const CHANGED_PRICING = `from app.infra.db import save\n\n\ndef quote(req: "flask.Request") -> int:\n    return 0\n`

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-jsonout-'))
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
  writeFileSync(join(root, 'app/domain/pricing.py'), CHANGED_PRICING)
  return root
}

/** Replays `responses` in order; the last one repeats once the list runs out. */
function fakeLlm(responses: string[]): LlmSetup {
  let calls = 0
  const client: LlmClient = {
    async complete() {
      const text = responses[Math.min(calls, responses.length - 1)]
      calls++
      return { text, model: 'fake-build', promptTokens: 7, completionTokens: 3 }
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

function runInput(repoRoot: string, llm: LlmSetup, extra: Record<string, unknown> = {}) {
  return {
    repoRoot,
    topologyPath: join(repoRoot, 'soll.ilograph.yaml'),
    rulesPath: join(repoRoot, 'architecture-rules.yaml'),
    base: 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff' as const,
    jsonOutPath: join(repoRoot, 'result.json'),
    cliArgs: [],
    llm,
    ...extra,
  }
}

function readJson(repoRoot: string): ConformanceResultDocument {
  return JSON.parse(readFileSync(join(repoRoot, 'result.json'), 'utf8')) as ConformanceResultDocument
}

function readLog(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('--json-out', () => {
  it('keeps every repetition, each with the findings of its own model answer', async () => {
    const repo = makeRepo()
    await runConformance(runInput(repo, fakeLlm([RESPONSE_FLASK, RESPONSE_DJANGO]), { runs: 2 }))
    const doc = readJson(repo)

    expect(doc.runs.map((r) => r.run_index)).toEqual([0, 1])
    const llmOf = (index: number) => doc.runs[index].findings.filter((f) => f.source === 'llm')
    expect(llmOf(0).map((f) => f.subject.offending_type)).toEqual(['flask.Request'])
    expect(llmOf(1).map((f) => f.subject.offending_type)).toEqual(['django.http.HttpRequest'])
  })

  it('shares its run_id with the run header, so the two documents join', async () => {
    const repo = makeRepo()
    const logPath = join(repo, 'log.jsonl')
    await runConformance(runInput(repo, fakeLlm([RESPONSE_FLASK]), { runLogPath: logPath }))

    expect(readJson(repo).run_id).toBe(readLog(logPath)[0].run_id)
  })

  it('does not deduplicate two findings that share a match_key', async () => {
    const repo = makeRepo()
    await runConformance(runInput(repo, fakeLlm([RESPONSE_DUPLICATE])))
    const llmFindings = readJson(repo).runs[0].findings.filter((f) => f.source === 'llm')

    expect(llmFindings).toHaveLength(2)
    expect(llmFindings[0].match_key).toBe(llmFindings[1].match_key)
    // Same key, different symbols: collapsing them is the analysis's decision, not the CLI's.
    expect(llmFindings.map((f) => f.reason)).toHaveLength(2)
  })

  it('labels each finding with the path that produced it', async () => {
    const repo = makeRepo()
    await runConformance(runInput(repo, fakeLlm([RESPONSE_FLASK])))
    const findings = readJson(repo).runs[0].findings

    expect(findings.filter((f) => f.source === 'rule-engine')).toHaveLength(1)
    expect(findings.filter((f) => f.source === 'llm')).toHaveLength(1)
    expect(findings.find((f) => f.source === 'rule-engine')!.rule_id).toBe('DERIVED:forbidden-edge')
  })

  it('emits the match_key byte for byte as matchKey.ts builds it', async () => {
    const repo = makeRepo()
    await runConformance(runInput(repo, fakeLlm([RESPONSE_FLASK])))

    for (const finding of readJson(repo).runs[0].findings) {
      expect(finding.match_key).toBe(
        buildMatchKey(
          finding.category,
          { component: finding.component, module: finding.module },
          finding.subject,
        ),
      )
    }
  })

  it('records the checks performed per repetition, with the file they were performed on', async () => {
    const repo = makeRepo()
    await runConformance(runInput(repo, fakeLlm([RESPONSE_FLASK, RESPONSE_FLASK]), { runs: 2 }))
    const doc = readJson(repo)

    for (const run of doc.runs) {
      expect(run.checks_performed).toEqual([
        {
          rule_id: 'no-domain-framework-coupling',
          scope: { components: ['domain'] },
          source: 'llm',
          file: 'app/domain/pricing.py',
        },
      ])
    }
  })

  it('aborts before the first model call when the json-out path is not writable', async () => {
    const repo = makeRepo()
    const llm = fakeLlm([RESPONSE_FLASK])
    llm.client = {
      complete: () => Promise.reject(new Error('the model must not be called on an unwritable output')),
    }

    await expect(
      runConformance(runInput(repo, llm, { jsonOutPath: join(repo, 'no-such-dir', 'result.json') })),
    ).rejects.toThrow(/cannot write json out at/)
  })

  it('stays consistent with the run log written by the same invocation', async () => {
    const repo = makeRepo()
    const logPath = join(repo, 'log.jsonl')
    await runConformance(runInput(repo, fakeLlm([RESPONSE_FLASK]), { runLogPath: logPath, runs: 2 }))
    const doc = readJson(repo)
    const lines = readLog(logPath)
    const footer = lines.at(-1)!

    expect(doc.run_id).toBe(footer.run_id)
    expect(footer.calls_total).toBe(lines.filter((l) => l.record_type === 'llm_call').length)
    expect(doc.validity.calls_total).toBe(footer.calls_total)
    expect(doc.validity.exit_code).toBe(footer.exit_code)
    expect(doc.validity.status).toBe(footer.status)
    expect(doc.validity.invalid_reasons).toEqual(footer.invalid_reasons)
    expect(doc.provenance.runs_requested).toBe(2)
    expect(doc.provenance.prompt_template_sha256).toBe(lines[0].prompt_template_sha256)
  })
})
