/**
 * `--control-files`: send UNCHANGED files through the LLM path so the false-positive rate gets a
 * denominator. Without it `localized` is not interpretable (Decision Record O, consequence 2).
 *
 * The point of the whole mechanism is that nothing about the stimulus changes. A false-positive
 * rate measured under a different prompt than the hits cannot be compared with them, and the model
 * must not be able to tell a control file from an injection file. `diff_kind` is therefore log
 * metadata only — the prompt-identity test below is what pins that, as a string comparison.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runConformance, type LlmSetup } from '../../../packages/triton-conformance/src/run'
import { parseArgs } from '../../../packages/triton-conformance/src/cliArgs'
import { buildUserPrompt } from '../../../packages/triton-conformance/src/contextBuilder'
import { CANARY_CONTEXT } from '../../../packages/triton-conformance/src/promptCanary'
import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'

const repos: string[] = []
afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const SOLL_YAML = `
resources:
  - id: domain
    children: [{ id: app.domain.pricing }, { id: app.domain.constants }, { id: app.domain.tax }]
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
    statement: Domain logic must not reference framework concepts.
    severity: error
`

/** Import- and reference-free, like the four INCORRECT_LOCATION carriers I25–I28. */
const EMPTY_MODULE = 'TAX_RATE = 19\n'

const BASE_FILES: Record<string, string> = {
  'soll.ilograph.yaml': SOLL_YAML,
  'architecture-rules.yaml': RULES_YAML,
  'app/domain/pricing.py': 'def quote(amount: int) -> int:\n    return amount\n',
  'app/domain/constants.py': 'MAX_DISCOUNT = 50\n',
  'app/domain/tax.py': EMPTY_MODULE,
  'app/api/routes.py': 'from app.domain.pricing import quote\n\n\ndef price(amount: int) -> int:\n    return quote(amount)\n',
}

/** The content every prompt-identity assertion is taken over — one import, one signature. */
const PRICING_V2 =
  'from app.api.routes import price\n\n\ndef quote(req: "flask.Request") -> int:\n    return price(0)\n'

const VALID_RESPONSE = JSON.stringify({ violations: [] })

interface Repo {
  root: string
  /** SHA of the first commit; diffing against it reports pricing.py as modified. */
  baseline: string
}

function makeRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), 'triton-control-'))
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
  const baseline = git('rev-parse', 'HEAD').trim()
  // Second commit: pricing.py now carries PRICING_V2. Against `baseline` the file is `modified`,
  // against HEAD the tree is clean — same bytes on disk either way, which is what lets the two
  // runs be compared prompt for prompt.
  writeFileSync(join(root, 'app/domain/pricing.py'), PRICING_V2)
  git('add', '-A')
  git('-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'change')
  return { root, baseline }
}

function writeControlList(root: string, name: string, lines: readonly string[]): string {
  const path = join(root, name)
  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}

/** Stub client: counts calls and keeps every user prompt verbatim. No model is ever contacted. */
function stubLlm(): { llm: LlmSetup; calls: () => number; prompts: () => string[] } {
  let calls = 0
  const prompts: string[] = []
  const client: LlmClient = {
    async complete(request) {
      calls++
      prompts.push(request.messages.find((m) => m.role === 'user')!.content)
      return { text: VALID_RESPONSE, model: 'stub-build', promptTokens: 1, completionTokens: 1 }
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
    prompts: () => prompts,
  }
}

function readLog(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

interface RunOptions {
  base?: string
  controlFilesPath?: string
  logName?: string
}

async function run(repo: Repo, llm: LlmSetup, options: RunOptions = {}) {
  const logPath = join(repo.root, options.logName ?? 'run-log.jsonl')
  const result = await runConformance({
    repoRoot: repo.root,
    topologyPath: join(repo.root, 'soll.ilograph.yaml'),
    rulesPath: join(repo.root, 'architecture-rules.yaml'),
    base: options.base ?? 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff',
    runLogPath: logPath,
    cliArgs: [],
    controlFilesPath: options.controlFilesPath,
    llm,
  })
  const lines = readLog(logPath)
  return {
    result,
    header: lines.find((l) => l.record_type === 'run_header')!,
    footer: lines.find((l) => l.record_type === 'run_footer')!,
    calls: lines.filter((l) => l.record_type === 'llm_call'),
  }
}

describe('--control-files', () => {
  it('checks N unchanged files and logs each as a control call', async () => {
    const repo = makeRepo()
    const stub = stubLlm()
    const list = writeControlList(repo.root, 'control.txt', [
      '# the control set is decided outside the tool (protocol §5 Rev. 17)',
      'app/domain/pricing.py',
      '',
      'app/domain/constants.py',
      'app/domain/tax.py',
    ])

    const { header, footer, calls } = await run(repo, stub.llm, { controlFilesPath: list })

    expect(calls).toHaveLength(3)
    expect(calls.every((c) => c.diff_kind === 'control')).toBe(true)
    expect(calls.map((c) => c.file)).toEqual([
      'app/domain/pricing.py',
      'app/domain/constants.py',
      'app/domain/tax.py',
    ])
    expect(stub.calls()).toBe(3)
    // The run acceptance rule of a control run: control_files_count == calls_total (protocol §6).
    expect(header.control_files_count).toBe(3)
    expect(footer.calls_total).toBe(3)
    expect(header.changed_files_count).toBe(0)
  })

  it('renders a control file exactly like the same file as modified — byte for byte', async () => {
    const repo = makeRepo()

    // Same bytes on disk in both runs; only the diff status differs.
    const asModified = stubLlm()
    await run(repo, asModified.llm, { base: repo.baseline, logName: 'modified.jsonl' })

    const asControl = stubLlm()
    const list = writeControlList(repo.root, 'control.txt', ['app/domain/pricing.py'])
    const control = await run(repo, asControl.llm, {
      controlFilesPath: list,
      logName: 'control.jsonl',
    })

    expect(asModified.prompts()).toHaveLength(1)
    expect(asControl.prompts()).toHaveLength(1)
    // The measurement condition of Increment 7, as a string comparison.
    expect(asControl.prompts()[0]).toBe(asModified.prompts()[0])
    // ... and the heading stays "# Changed file" for a control file, so the model cannot tell.
    expect(asControl.prompts()[0]).toContain('# Changed file')
    expect(asControl.prompts()[0]).not.toContain('control')
    // The distinction survives only in the log, where the harness needs it.
    expect(control.calls[0].diff_kind).toBe('control')
  })

  it('never lets diff_kind reach the prompt', () => {
    // Direct proof at the render function: the only differing field changes nothing in the output.
    const modified = buildUserPrompt(CANARY_CONTEXT)
    const control = buildUserPrompt({
      ...CANARY_CONTEXT,
      fact: { ...CANARY_CONTEXT.fact, diff_kind: 'control' },
    })

    expect(control).toBe(modified)
  })

  it('pins the prompt of an import- and signature-free module verbatim', async () => {
    const repo = makeRepo()
    const stub = stubLlm()
    const list = writeControlList(repo.root, 'control.txt', ['app/domain/tax.py'])

    await run(repo, stub.llm, { controlFilesPath: list })

    // The empty-render branch (no imports, no signatures) is NOT covered by the canary hash
    // (promptCanary.ts, B27) and carries four measured injections, I25–I28. Pinned literally
    // because a defect here would surface as four model errors instead of a rendering bug.
    expect(stub.prompts()[0]).toBe(
      [
        '# Changed file',
        'path: app/domain/tax.py',
        'module: app.domain.tax',
        'component: domain',
        '',
        '## Imports',
        '',
        '## Signatures',
        '',
        '## Allowed dependency edges touching this component',
        '- api -> domain',
        '',
        '## Rules to check (scope includes this component)',
        '- id: no-domain-framework-coupling [semantic, error] (semantic-framework-leak)',
        '  Domain logic must not reference framework concepts.',
      ].join('\n'),
    )
  })

  it('counts a file that is in both sets once, as modified', async () => {
    const repo = makeRepo()
    const stub = stubLlm()
    const list = writeControlList(repo.root, 'control.txt', [
      'app/domain/pricing.py',
      'app/domain/constants.py',
    ])

    const { result, header, footer, calls } = await run(repo, stub.llm, {
      base: repo.baseline,
      controlFilesPath: list,
    })

    const pricing = calls.filter((c) => c.file === 'app/domain/pricing.py')
    expect(pricing).toHaveLength(1)
    expect(pricing[0].diff_kind).toBe('modified')
    expect(calls).toHaveLength(2)
    expect(footer.calls_total).toBe(2)
    // It left the control denominator and the reclassification is on record, not silent.
    expect(header.changed_files_count).toBe(1)
    expect(header.control_files_count).toBe(1)
    expect(header.control_files_overlap).toEqual(['app/domain/pricing.py'])
    expect(result.controlOverlap).toEqual(['app/domain/pricing.py'])
  })

  it('makes no call for a control file with no rule in scope', async () => {
    const repo = makeRepo()
    const stub = stubLlm()
    // `api` carries no rule, and a file with nothing in scope has never been sent to the model
    // (llmChecker.ts:96) — control files inherit that. The acceptance rule
    // `control_files_count == calls_total` therefore presupposes that every listed file has at
    // least one rule in scope; where it does not, the coverage gap is what the run reports.
    const list = writeControlList(repo.root, 'control.txt', ['app/api/routes.py'])

    const { header, footer, result } = await run(repo, stub.llm, { controlFilesPath: list })

    expect(stub.calls()).toBe(0)
    expect(footer.calls_total).toBe(0)
    expect(header.control_files_count).toBe(1)
    expect(result.results[0].checks_performed).toEqual([])
  })

  it('aborts on a path that does not exist, naming it', async () => {
    const repo = makeRepo()
    const stub = stubLlm()
    const list = writeControlList(repo.root, 'control.txt', [
      'app/domain/pricing.py',
      'app/domain/ghost.py',
    ])

    // A silent skip would shrink the false-positive denominator unnoticed — the same failure class
    // as the three silent failures already on record.
    await expect(run(repo, stub.llm, { controlFilesPath: list })).rejects.toThrow(
      /app\/domain\/ghost\.py/,
    )
    expect(stub.calls()).toBe(0)
  })

  it('carries both counts into the json-out provenance', async () => {
    const repo = makeRepo()
    const stub = stubLlm()
    const list = writeControlList(repo.root, 'control.txt', ['app/domain/constants.py'])
    const jsonPath = join(repo.root, 'result.json')

    await runConformance({
      repoRoot: repo.root,
      topologyPath: join(repo.root, 'soll.ilograph.yaml'),
      rulesPath: join(repo.root, 'architecture-rules.yaml'),
      base: repo.baseline,
      sourceRoots: [],
      ruleGraph: 'diff',
      jsonOutPath: jsonPath,
      cliArgs: [],
      controlFilesPath: list,
      llm: stub.llm,
    })
    const document = JSON.parse(readFileSync(jsonPath, 'utf8'))

    expect(document.provenance.changed_files_count).toBe(1)
    expect(document.provenance.control_files_count).toBe(1)
  })
})

describe('--control-files argument parsing', () => {
  const base = ['--topology', 'soll.yaml', '--rules', 'rules.yaml']

  it('reads the path and defaults to unset', () => {
    expect(parseArgs([...base, '--control-files', 'control.txt']).controlFiles).toBe('control.txt')
    expect(parseArgs(base).controlFiles).toBeUndefined()
  })

  it('is offered in the usage line', () => {
    expect(() => parseArgs([])).toThrow(/--control-files <file\.txt>/)
  })
})
