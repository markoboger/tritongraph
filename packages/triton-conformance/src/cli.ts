#!/usr/bin/env node
import { createOpenAiClient } from './llmClient'
import { formatReport, exitCode } from './reporter'
import { runConformance, type LlmSetup } from './run'
import { parseArgs } from './cliArgs'

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
 * llm_call per checked file and repetition); without it nothing is written. `--runs N` repeats the
 * LLM path N times so the eval harness can measure model variance.
 *
 * Run after `npm install && npm run build`: `triton-conformance --topology soll.ilograph.yaml --rules architecture-rules.yaml`
 */
/** Effective sampling parameters (C-5): fixed here, sent to the provider and logged as such. */
const TEMPERATURE = 0
const SEED = 42

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
    runs: args.runs,
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
