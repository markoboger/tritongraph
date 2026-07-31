#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import type { IlographDocument } from '../../triton-core/src/ilographTypes'
import type { CheckResult, SollModel } from './types'
import { resolveTopology } from './topology'
import { parseArchitectureRules } from './rules'
import { changedPythonFiles } from './gitDiff'
import { extractFacts, pythonFilesUnder, type SkippedFile } from './cliExtractor'
import { observedImportsFromFacts } from './ruleEngine'
import { check } from './check'
import { createOpenAiClient } from './llmClient'
import { formatReport, exitCode } from './reporter'

/**
 * The measurement core CLI (C-8). Runs the full check locally: git diff → Python ast → changed_facts
 * → rule-engine + (optional) LLM → report + exit code. This is where measurements are taken; the CI
 * and editor shapes call the same core but do not measure.
 *
 * The rule-engine graph is diff-only by default, so cycle detection only sees the changed files.
 * `--rule-graph full` parses every *.py under the source roots instead and builds the observed
 * graph from all of those facts (plan Correction 1). The LLM checker stays per changed file either
 * way.
 *
 * Run after `npm install && npm run build`: `triton-conformance --topology soll.ilograph.yaml --rules architecture-rules.yaml`
 */
type RuleGraphMode = 'diff' | 'full'

interface CliArgs {
  topology: string
  rules: string
  base: string
  sourceRoots: string[]
  ruleGraph: RuleGraphMode
}

const USAGE =
  'usage: triton-conformance --topology <ilograph.yaml> --rules <rules.yaml> [--base <ref>] [--src-root <dir>] [--rule-graph diff|full]'

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { topology: '', rules: '', base: 'HEAD', sourceRoots: [], ruleGraph: 'diff' }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    if (argv[i] === '--topology') args.topology = next()
    else if (argv[i] === '--rules') args.rules = next()
    else if (argv[i] === '--base') args.base = next()
    else if (argv[i] === '--src-root') args.sourceRoots.push(next())
    else if (argv[i] === '--rule-graph') args.ruleGraph = parseRuleGraph(next())
  }
  if (!args.topology || !args.rules) throw new Error(USAGE)
  return args
}

function parseRuleGraph(value: string): RuleGraphMode {
  if (value !== 'diff' && value !== 'full') {
    throw new Error(`--rule-graph must be 'diff' or 'full', got '${value}'\n${USAGE}`)
  }
  return value
}

function loadSoll(topologyPath: string, rulesPath: string): SollModel {
  const topologyDoc = yaml.load(readFileSync(topologyPath, 'utf8')) as IlographDocument
  const rulesRaw = yaml.load(readFileSync(rulesPath, 'utf8'))
  return { topology: resolveTopology(topologyDoc), rules: parseArchitectureRules(rulesRaw) }
}

/** Optional LLM from env (key only ever supplied here, server-side — never in the browser). */
function llmFromEnv() {
  const apiKey = process.env.CONFORMANCE_API_KEY
  if (!apiKey) return undefined
  const client = createOpenAiClient({
    apiKey,
    baseUrl: process.env.CONFORMANCE_BASE_URL ?? 'https://openrouter.ai/api/v1',
    model: process.env.CONFORMANCE_MODEL ?? 'openai/gpt-4o-mini',
  })
  return { client, options: { modelRequested: process.env.CONFORMANCE_MODEL ?? 'openai/gpt-4o-mini' } }
}

/** What one CLI run produced. `skipped` is what Increment 2 will write into the run-log header. */
interface CliRunResult {
  results: CheckResult[]
  skipped: SkippedFile[]
}

async function runCheck(args: CliArgs, repoRoot: string): Promise<CliRunResult> {
  const soll = loadSoll(args.topology, args.rules)

  // The LLM checker and the per-file results always follow the diff, in both rule-graph modes.
  const changed = changedPythonFiles({ repoRoot, base: args.base })
  const diff = extractFacts(repoRoot, changed, soll.topology, args.sourceRoots)

  // In full mode the rule-engine sees every file under the source roots, so cycles and forbidden
  // edges running through unchanged files are found too.
  const graph =
    args.ruleGraph === 'full'
      ? extractFacts(repoRoot, pythonFilesUnder(repoRoot, args.sourceRoots), soll.topology, args.sourceRoots)
      : diff

  const results = await check({
    soll,
    changedFacts: diff.facts,
    observedImports: observedImportsFromFacts(graph.facts),
    llm: llmFromEnv(),
  })
  return { results, skipped: dedupeByPath([...diff.skipped, ...graph.skipped]) }
}

function dedupeByPath(skipped: readonly SkippedFile[]): SkippedFile[] {
  return [...new Map(skipped.map((s) => [s.path, s])).values()]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const run = await runCheck(args, process.cwd())

  for (const file of run.skipped) console.error(`skipped ${file.path}: ${file.reason}`)
  console.log(formatReport(run.results))
  process.exit(exitCode(run.results))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(2)
})
