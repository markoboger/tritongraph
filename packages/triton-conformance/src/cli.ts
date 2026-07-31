#!/usr/bin/env node
import { createOpenAiClient } from './llmClient'
import { formatReport, exitCode } from './reporter'
import { runConformance, type LlmSetup } from './run'
import type { RuleGraphMode } from './runLog'

/**
 * The measurement core CLI (C-8). Runs the full check locally: git diff → Python ast → changed_facts
 * → rule-engine + (optional) LLM → report + exit code. This is where measurements are taken; the CI
 * and editor shapes call the same core but do not measure. The run itself lives in run.ts; this
 * file only turns argv and the environment into a run and a process exit.
 *
 * The rule-engine graph is diff-only by default, so cycle detection only sees the changed files.
 * `--rule-graph full` parses every *.py under the source roots instead and builds the observed
 * graph from all of those facts (plan Correction 1). The LLM checker stays per changed file either
 * way.
 *
 * `--run-log <file.jsonl>` persists the raw measurement records (one run_header per invocation, one
 * llm_call per checked file); without it nothing is written.
 *
 * Run after `npm install && npm run build`: `triton-conformance --topology soll.ilograph.yaml --rules architecture-rules.yaml`
 */
interface CliArgs {
  topology: string
  rules: string
  base: string
  sourceRoots: string[]
  ruleGraph: RuleGraphMode
  runLog?: string
}

const USAGE =
  'usage: triton-conformance --topology <ilograph.yaml> --rules <rules.yaml> [--base <ref>] [--src-root <dir>] [--rule-graph diff|full] [--run-log <file.jsonl>]'

/** Effective sampling parameters (C-5): fixed here, sent to the provider and logged as such. */
const TEMPERATURE = 0
const SEED = 42

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { topology: '', rules: '', base: 'HEAD', sourceRoots: [], ruleGraph: 'diff' }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    if (argv[i] === '--topology') args.topology = next()
    else if (argv[i] === '--rules') args.rules = next()
    else if (argv[i] === '--base') args.base = next()
    else if (argv[i] === '--src-root') args.sourceRoots.push(next())
    else if (argv[i] === '--rule-graph') args.ruleGraph = parseRuleGraph(next())
    else if (argv[i] === '--run-log') args.runLog = next()
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

/** Optional LLM from env (key only ever supplied here, server-side — never in the browser). */
function llmFromEnv(): LlmSetup | undefined {
  const apiKey = process.env.CONFORMANCE_API_KEY
  if (!apiKey) return undefined
  const model = process.env.CONFORMANCE_MODEL ?? 'openai/gpt-4o-mini'
  const baseUrl = process.env.CONFORMANCE_BASE_URL ?? 'https://openrouter.ai/api/v1'
  const client = createOpenAiClient({ apiKey, baseUrl, model, temperature: TEMPERATURE, seed: SEED })
  return {
    client,
    options: { modelRequested: model, temperature: TEMPERATURE, seed: SEED },
    baseUrl,
    seed: SEED,
    temperature: TEMPERATURE,
  }
}

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2)
  const args = parseArgs(cliArgs)
  const run = await runConformance({
    repoRoot: process.cwd(),
    topologyPath: args.topology,
    rulesPath: args.rules,
    base: args.base,
    sourceRoots: args.sourceRoots,
    ruleGraph: args.ruleGraph,
    runLogPath: args.runLog,
    cliArgs,
    llm: llmFromEnv(),
  })

  for (const file of run.skipped) console.error(`skipped ${file.path}: ${file.reason}`)
  console.log(formatReport(run.results))
  process.exit(exitCode(run.results))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(2)
})
