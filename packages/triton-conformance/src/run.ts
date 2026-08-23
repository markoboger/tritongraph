import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import type { IlographDocument } from '../../triton-core/src/ilographTypes'
import type { ChangedFact, CheckResult, SollModel } from './types'
import { resolveTopology } from './topology'
import { parseArchitectureRules } from './rules'
import { changedPythonFiles, gitHead } from './gitDiff'
import {
  extractFacts,
  pythonFilesUnder,
  readControlFileList,
  type SkippedFile,
} from './cliExtractor'
import { observedImportsFromFacts } from './ruleEngine'
import { check } from './check'
import {
  exitCodeFor,
  invalidReasons,
  newCallTally,
  type CallTally,
  type RunValidity,
} from './reporter'
import { DEFAULT_TIMEOUT_MS, providerPinBody, type LlmClient } from './llmClient'
import {
  TRANSPORT_ABORT_THRESHOLD,
  TRANSPORT_MAX_RETRIES,
  TransportAbortError,
  checkFactWithLlm,
  type LlmCheckOptions,
} from './llmChecker'
import { SYSTEM_PROMPT, buildUserPrompt } from './contextBuilder'
import { CANARY_CONTEXT } from './promptCanary'
import {
  RESULT_SCHEMA_VERSION,
  createJsonOutWriter,
  toJsonRun,
  type JsonRun,
  type ResultProvenance,
} from './jsonOut'
import {
  LOG_SCHEMA_VERSION,
  createRunLogWriter,
  fileSha256,
  llmCallRecords,
  newRunId,
  nowIso,
  sanitizeEndpoint,
  sha256Text,
  type RuleGraphMode,
  type RunHeaderRecord,
  type RunLogWriter,
} from './runLog'

/**
 * One conformance run, independent of argv and process exit — the CLI parses arguments and this
 * drives the measurement: git diff → facts → rule-engine + (optional) LLM → results, plus the
 * run-log records if a log path was given. Kept out of cli.ts so tests can drive a full run with an
 * injected LLM client.
 */
export interface LlmSetup {
  client: LlmClient
  options: LlmCheckOptions
  /** Effective base URL of the provider; logged sanitized. */
  baseUrl: string
  /** Effective values as sent to the provider (C-5). */
  seed: number
  temperature: number
  /** Backend the calls are pinned to; the header logs the routing block this produces. */
  providerPin?: string
}

export interface ConformanceRunInput {
  repoRoot: string
  topologyPath: string
  rulesPath: string
  base: string
  sourceRoots: readonly string[]
  ruleGraph: RuleGraphMode
  /** JSONL run log; nothing is written when absent. */
  runLogPath?: string
  /** Repetitions of the LLM path (--runs), default 1. The rule-engine always runs exactly once. */
  runs?: number
  /** Value of --timeout-ms, logged as a measurement parameter; the client enforces it per call. */
  timeoutMs?: number
  /** Machine-readable result document; nothing is written when absent. */
  jsonOutPath?: string
  /**
   * Path to a list of unchanged files (--control-files) that go through the LLM path too. Their
   * findings are false positives by construction, which is what makes the rate measurable.
   */
  controlFilesPath?: string
  /** argv without the process name, logged verbatim in the run header. */
  cliArgs: readonly string[]
  llm?: LlmSetup
}

/** What one run produced. `skipped` is reported on stderr by the CLI and logged in the header. */
export interface ConformanceRunResult {
  results: CheckResult[]
  skipped: SkippedFile[]
  /** Whether the run was a sound measurement; drives exit code 3 and the footer. */
  validity: RunValidity
  /** The code the CLI exits with (see exitCodeFor). */
  exitCode: number
  /** Control paths the diff also carries; they ran as `modified`. Reported on stderr by the CLI. */
  controlOverlap: string[]
}

export async function runConformance(input: ConformanceRunInput): Promise<ConformanceRunResult> {
  const startedAt = Date.now()
  // Read before anything is opened or paid for: a missing control path must abort, and it must
  // abort without leaving a half-written log behind.
  const controlPaths = input.controlFilesPath
    ? readControlFileList(input.repoRoot, input.controlFilesPath)
    : []
  // Fail before any model call if an output is not writable.
  const log = input.runLogPath ? createRunLogWriter(input.runLogPath) : null
  const jsonOut = input.jsonOutPath ? createJsonOutWriter(input.jsonOutPath) : null
  const runId = newRunId()
  const soll = loadSoll(input.topologyPath, input.rulesPath)

  // The LLM checker and the per-file results always follow the diff, in both rule-graph modes.
  const changed = changedPythonFiles({ repoRoot: input.repoRoot, base: input.base })
  const diff = extractFacts(input.repoRoot, changed, soll.topology, input.sourceRoots)

  // A file that is in both sets is a changed file, not a control observation: `modified` wins, and
  // the reclassification is written down rather than applied quietly.
  const changedPaths = new Set(changed.map((file) => file.path))
  const controlOverlap = controlPaths.filter((path) => changedPaths.has(path))
  const controlOnly = controlPaths.filter((path) => !changedPaths.has(path))
  const control = extractFacts(
    input.repoRoot,
    controlOnly.map((path) => ({ path, diff_kind: 'control' as const })),
    soll.topology,
    input.sourceRoots,
  )
  // One list for the LLM path: control files are checked by exactly the same code, with exactly the
  // same prompt — a false-positive rate measured under a different stimulus than the hits would not
  // be comparable with them.
  const checkedFacts = [...diff.facts, ...control.facts]

  // In full mode the rule-engine sees every file under the source roots, so cycles and forbidden
  // edges running through unchanged files are found too.
  const graph =
    input.ruleGraph === 'full'
      ? extractFacts(
          input.repoRoot,
          pythonFilesUnder(input.repoRoot, input.sourceRoots),
          soll.topology,
          input.sourceRoots,
        )
      : diff

  const skipped = dedupeByPath([...diff.skipped, ...control.skipped, ...graph.skipped])
  // Built once: the header is also where the result document takes its provenance from, so the two
  // documents can never disagree about which Soll, prompt and checker build produced the findings.
  const header = buildRunHeader(input, runId, {
    changedFilesCount: changed.length,
    controlFilesCount: controlOnly.length,
    controlOverlap,
    graphFilesCount: graph.facts.length,
    skipped,
  })
  log?.write(header)

  const runsRequested = input.runs ?? 1
  const tally = newCallTally()
  let runsCompleted = 0
  let results: CheckResult[] = []
  let exit = 2
  let providerOutage = false
  // Every repetition, not just the one the report prints: the analysis needs each run's findings.
  const perRun: JsonRun[] = []

  // The footer is written whichever way this ends: a header with no footer is the mark of a run
  // that died hard, so every ordinary abort must still close its own record.
  try {
    try {
      // Repetition 0 is the run that produces the report: rule-engine plus, if configured, the LLM.
      results = await check({
        soll,
        changedFacts: checkedFacts,
        observedImports: observedImportsFromFacts(graph.facts),
        llm: input.llm
          ? { client: input.llm.client, options: { ...input.llm.options, runIndex: 0, tally } }
          : undefined,
      })
      recordCalls(log, runId, checkedFacts, results)
      perRun.push(toJsonRun(0, results))
      runsCompleted++

      // Further repetitions measure the model only. They deliberately do NOT go through check(): the
      // deterministic rule-engine cannot vary between repetitions, so re-running it would only produce
      // duplicate structural findings. Repetitions are logged, never merged into the reported results —
      // aggregating across runs is the eval harness's job.
      for (let runIndex = 1; runIndex < runsRequested; runIndex++) {
        // Without an LLM a repetition has nothing to call, so it completes trivially — counting it as
        // incomplete would raise a false alarm about a run that did everything it was asked to do.
        if (input.llm) {
          const repeated = await repeatLlmRun(soll, checkedFacts, input.llm, runIndex, tally)
          recordCalls(log, runId, checkedFacts, repeated)
          // Model findings only: the rule-engine ran once, so its findings live in run_index 0.
          perRun.push(toJsonRun(runIndex, repeated))
        }
        runsCompleted++
      }
    } catch (err) {
      // A provider that stopped answering aborts the run, but it is not a broken program: the run
      // reports what it managed to measure and exits 3 like every other unsound run.
      if (!(err instanceof TransportAbortError)) throw err
      providerOutage = true
    }

    const validity = buildValidity(tally, runsRequested, runsCompleted, skipped.length)
    exit = exitCodeFor(results, validity)
    return { results, skipped, validity, exitCode: exit, controlOverlap }
  } finally {
    const status = runsCompleted === runsRequested ? 'completed' : 'aborted'
    // Only a program error keeps code 2; a provider outage aborts too but stays a measurement
    // problem, and exitCodeFor has already put 3 in `exit` for it.
    if (status === 'aborted' && !providerOutage) exit = 2
    const validity = buildValidity(tally, runsRequested, runsCompleted, skipped.length)
    // Written from the same finally as the footer, so even an aborted run leaves its partial result.
    jsonOut?.write({
      result_schema_version: RESULT_SCHEMA_VERSION,
      run_id: runId,
      timestamp: nowIso(),
      provenance: buildProvenance(header),
      runs: perRun,
      validity: {
        status,
        runs_completed: runsCompleted,
        calls_total: tally.total,
        calls_invalid: tally.invalid.length,
        calls_transport_failed: tally.transportFailed.length,
        skipped_count: skipped.length,
        invalid_reasons: invalidReasons(validity),
        exit_code: exit,
      },
      skipped,
    })
    log?.write({
      record_type: 'run_footer',
      run_id: runId,
      timestamp: nowIso(),
      status,
      runs_requested: runsRequested,
      runs_completed: runsCompleted,
      calls_total: tally.total,
      calls_invalid: tally.invalid.length,
      invalid_calls: tally.invalid,
      calls_transport_failed: tally.transportFailed.length,
      failed_calls: tally.transportFailed,
      calls_with_transport_retry: tally.withTransportRetry,
      skipped_count: skipped.length,
      exit_code: exit,
      invalid_reasons: invalidReasons(validity),
      wall_clock_ms: Date.now() - startedAt,
    })
  }
}

function buildValidity(
  tally: CallTally,
  runsRequested: number,
  runsCompleted: number,
  skippedCount: number,
): RunValidity {
  return {
    invalid_calls: tally.invalid,
    failed_calls: tally.transportFailed,
    runs_requested: runsRequested,
    runs_completed: runsCompleted,
    skipped_count: skippedCount,
  }
}

async function repeatLlmRun(
  soll: SollModel,
  facts: readonly ChangedFact[],
  llm: LlmSetup,
  runIndex: number,
  tally: CallTally,
): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const fact of facts) {
    const out = await checkFactWithLlm(fact, soll, llm.client, { ...llm.options, runIndex, tally })
    results.push({
      file: fact.path,
      module: fact.module,
      violations: out.violations,
      checks_performed: out.checks_performed,
      run: out.run,
    })
  }
  return results
}

export function loadSoll(topologyPath: string, rulesPath: string): SollModel {
  const topologyDoc = yaml.load(readFileSync(topologyPath, 'utf8')) as IlographDocument
  const rulesRaw = yaml.load(readFileSync(rulesPath, 'utf8'))
  return { topology: resolveTopology(topologyDoc), rules: parseArchitectureRules(rulesRaw) }
}

interface RunCounts {
  changedFilesCount: number
  controlFilesCount: number
  controlOverlap: readonly string[]
  graphFilesCount: number
  skipped: readonly SkippedFile[]
}

function buildRunHeader(
  input: ConformanceRunInput,
  runId: string,
  counts: RunCounts,
): RunHeaderRecord {
  return {
    record_type: 'run_header',
    log_schema_version: LOG_SCHEMA_VERSION,
    run_id: runId,
    timestamp: nowIso(),
    cli_args: input.cliArgs,
    rule_graph_mode: input.ruleGraph,
    topology_path: input.topologyPath,
    topology_sha256: fileSha256(input.topologyPath),
    rules_path: input.rulesPath,
    rules_sha256: fileSha256(input.rulesPath),
    prompt_template_sha256: sha256Text(SYSTEM_PROMPT),
    user_prompt_render_sha256: sha256Text(buildUserPrompt(CANARY_CONTEXT)),
    target_repo_git_head: gitHead(input.repoRoot),
    checker_git_head: gitHead(checkerDirectory()),
    base_ref: input.base,
    src_roots: input.sourceRoots,
    model_requested: input.llm?.options.modelRequested ?? null,
    endpoint: input.llm ? sanitizeEndpoint(input.llm.baseUrl) : null,
    seed_requested: input.llm?.seed ?? null,
    temperature_requested: input.llm?.temperature ?? null,
    // Same helper the client sends with, so header and request body cannot drift apart.
    provider_pin: providerPinBody(input.llm?.providerPin),
    runs_requested: input.runs ?? 1,
    timeout_ms: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    transport_max_retries: TRANSPORT_MAX_RETRIES,
    transport_abort_threshold: TRANSPORT_ABORT_THRESHOLD,
    changed_files_count: counts.changedFilesCount,
    control_files_count: counts.controlFilesCount,
    control_files_overlap: counts.controlOverlap,
    graph_files_count: counts.graphFilesCount,
    skipped: counts.skipped,
  }
}

/** Straight from the header record: no value is recomputed, so the two documents cannot drift. */
function buildProvenance(header: RunHeaderRecord): ResultProvenance {
  return {
    topology_sha256: header.topology_sha256,
    rules_sha256: header.rules_sha256,
    prompt_template_sha256: header.prompt_template_sha256,
    user_prompt_render_sha256: header.user_prompt_render_sha256,
    checker_git_head: header.checker_git_head,
    target_repo_git_head: header.target_repo_git_head,
    base_ref: header.base_ref,
    rule_graph_mode: header.rule_graph_mode,
    model_requested: header.model_requested,
    endpoint: header.endpoint,
    seed_requested: header.seed_requested,
    temperature_requested: header.temperature_requested,
    runs_requested: header.runs_requested,
    timeout_ms: header.timeout_ms,
    changed_files_count: header.changed_files_count,
    control_files_count: header.control_files_count,
  }
}

/**
 * Records are built even without a log, so the pairing invariant in llmCallRecords is checked on
 * every run — an unattributable result is a program error whether or not anyone is writing it down.
 * What the run is worth is counted at the call site (see CallTally), not reconstructed from here.
 */
function recordCalls(
  log: RunLogWriter | null,
  runId: string,
  facts: readonly ChangedFact[],
  results: readonly CheckResult[],
): void {
  for (const record of llmCallRecords(runId, facts, results)) log?.write(record)
}

function checkerDirectory(): string {
  return dirname(fileURLToPath(import.meta.url))
}

function dedupeByPath(skipped: readonly SkippedFile[]): SkippedFile[] {
  return [...new Map(skipped.map((s) => [s.path, s])).values()]
}
