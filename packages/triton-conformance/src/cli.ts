#!/usr/bin/env node
import { createOpenAiClient } from './llmClient'
import { formatReport, formatValidityWarnings } from './reporter'
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
 * llm_call per checked file and repetition, one run_footer at the end); without it nothing is
 * written. `--runs N` repeats the LLM path N times so the eval harness can measure model variance.
 * `--timeout-ms N` bounds a single model call; transport trouble (timeout, network, 429, 5xx) is
 * retried on its own budget and never counted as a model failure. `--json-out <file.json>` writes
 * the findings of every repetition in machine-readable form — what was found; the run log keeps
 * what it cost, and the two are joined on (run_id, file, run_index).
 *
 * Exit codes: 0 clean, 1 violations found, 2 program/configuration error, 3 the run is not a sound
 * measurement (3 wins over 0 and 1 — see exitCodeFor). A provider outage aborts the run but is a
 * measurement problem, so it exits 3, not 2.
 *
 * Run after `npm install && npm run build`: `triton-conformance --topology soll.ilograph.yaml --rules architecture-rules.yaml`
 */
/** Effective sampling parameters (C-5): fixed here, sent to the provider and logged as such. */
const TEMPERATURE = 0
const SEED = 42

/** Optional LLM from env (key only ever supplied here, server-side — never in the browser). */
function llmFromEnv(timeoutMs: number): LlmSetup | undefined {
  const apiKey = process.env.CONFORMANCE_API_KEY
  if (!apiKey) return undefined
  const model = process.env.CONFORMANCE_MODEL ?? 'openai/gpt-4o-mini'
  const baseUrl = process.env.CONFORMANCE_BASE_URL ?? 'https://openrouter.ai/api/v1'
  // Unset → no pin at all. A router that multiplexes backends (OpenRouter) needs one so a run
  // cannot be served by a different backend than the one it was measured on; a single-backend
  // endpoint (Ollama) must not be sent the field, since its handling of it is unknown.
  const providerPin = process.env.CONFORMANCE_PROVIDER_PIN || undefined
  const client = createOpenAiClient({
    apiKey,
    baseUrl,
    model,
    temperature: TEMPERATURE,
    seed: SEED,
    timeoutMs,
    providerPin,
  })
  return {
    client,
    options: { modelRequested: model, temperature: TEMPERATURE, seed: SEED },
    baseUrl,
    seed: SEED,
    temperature: TEMPERATURE,
    providerPin,
  }
}

async function main(): Promise<void> {
  const cliArgs = process.argv.slice(2)
  const args = parseArgs(cliArgs)
  if (args.runs > 1 && !args.runLog) {
    console.error(
      `warning: --runs ${args.runs} without --run-log — repetitions 1..${args.runs - 1} are paid for but only repetition 0 is visible`,
    )
  }
  const run = await runConformance({
    repoRoot: process.cwd(),
    topologyPath: args.topology,
    rulesPath: args.rules,
    base: args.base,
    sourceRoots: args.sourceRoots,
    ruleGraph: args.ruleGraph,
    runLogPath: args.runLog,
    runs: args.runs,
    timeoutMs: args.timeoutMs,
    jsonOutPath: args.jsonOut,
    cliArgs,
    llm: llmFromEnv(args.timeoutMs),
  })

  for (const file of run.skipped) console.error(`skipped ${file.path}: ${file.reason}`)
  console.log(formatReport(run.results))
  for (const line of formatValidityWarnings(run.validity)) console.log(line)
  process.exit(run.exitCode)
}

// Anything that escapes main() is a program or configuration error: exit 2, never a measurement
// code. The run log has already closed itself with an "aborted" footer at this point.
main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(2)
})
