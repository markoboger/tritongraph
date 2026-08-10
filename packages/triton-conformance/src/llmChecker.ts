import type {
  ArchitectureRule,
  CallOutcome,
  ChangedFact,
  CheckPerformed,
  RunAttempt,
  RunLog,
  SollModel,
  TransportFailure,
  ViolationRecord,
  ViolationSubject,
} from './types'
import { buildMatchKey } from './matchKey'
import { validateViolationRecord } from './validate'
import { buildMessages, buildPromptContext, type ChatMessage } from './contextBuilder'
import { VIOLATIONS_SCHEMA, TransportError, promptHash, type LlmClient, type LlmRequest, type LlmResponse } from './llmClient'
import type { CallTally } from './reporter'

/** Transport retries per call: fixed and small. No jitter, no exponential growth — explainable. */
export const TRANSPORT_BACKOFF_MS: readonly number[] = [1000, 4000]
export const TRANSPORT_MAX_RETRIES = TRANSPORT_BACKOFF_MS.length
/** A provider's `Retry-After` is honoured, but never longer than this. */
export const RETRY_AFTER_CAP_MS = 60_000
/** Consecutive calls lost to transport before the run gives up on the provider. */
export const TRANSPORT_ABORT_THRESHOLD = 5

/**
 * The provider has failed TRANSPORT_ABORT_THRESHOLD calls in a row, so the run stops instead of
 * burning an unattended campaign against a dead endpoint. Not a program error: it exits 3.
 */
export class TransportAbortError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransportAbortError'
  }
}

/** Model-asserted violation (the subset the model fills; we add source + match_key). */
interface LlmViolation {
  rule_id: string
  symbol?: string
  line?: number
  subject: ViolationSubject
  reason: string
  suggestion: string
  confidence?: number
}

export interface LlmCheckOptions {
  modelRequested: string
  /** 0-based repetition index (--runs); defaults to the single run 0. */
  runIndex?: number
  /** Max retries after an invalid attempt (C-2). Default 2. */
  maxRetries?: number
  temperature?: number
  seed?: number
  /** Shared across every call of one run: the call tally and the outage brake. */
  tally?: CallTally
  /** Backoff between transport retries. Only tests shorten it; a run uses TRANSPORT_BACKOFF_MS. */
  transportBackoffMs?: readonly number[]
}

export interface LlmCheckOutput {
  violations: ViolationRecord[]
  checks_performed: CheckPerformed[]
  /** Absent when no in-scope rules → the LLM was never called (coverage gap, not a model run). */
  run?: RunLog
}

/**
 * LLM-checker [3b] for a single changed file (per-file granularity is the OD-3 default). Runs the
 * in-scope rules through the model; a parse/validation failure is an invalid attempt → retry with
 * feedback, never a crash (C-2). Logs valid_raw vs valid_final separately (C-2, C-6).
 */
export async function checkFactWithLlm(
  fact: ChangedFact,
  soll: SollModel,
  client: LlmClient,
  options: LlmCheckOptions,
): Promise<LlmCheckOutput> {
  // Checked before the call is paid for, so every failure that opened the brake is still logged.
  if ((options.tally?.consecutiveTransportFailures ?? 0) >= TRANSPORT_ABORT_THRESHOLD) {
    throw new TransportAbortError(
      `provider unreachable: ${TRANSPORT_ABORT_THRESHOLD} consecutive calls failed in transport`,
    )
  }

  const context = buildPromptContext(soll, fact)
  const checks_performed: CheckPerformed[] = context.rules.map((rule) => ({
    rule_id: rule.id,
    scope: rule.scope,
    source: 'llm',
  }))

  // No rules in scope → nothing for the LLM to do. Skip the call (cost) but record the coverage.
  if (context.rules.length === 0) return { violations: [], checks_performed }

  const messages = buildMessages(context)
  const initialPrompt = JSON.stringify(messages)
  const maxRetries = options.maxRetries ?? 2

  let attempt = 0
  let validRaw = false
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalLatency = 0
  let lastRaw = ''
  let modelVersion = options.modelRequested
  let modelVersionReported: string | null = null
  let providerServed: string | null = null
  let violations: ViolationRecord[] = []
  let validFinal = false
  const attempts: RunAttempt[] = []
  const conversation: ChatMessage[] = [...messages]
  const transportFailures: TransportFailure[] = []
  let outcome: CallOutcome = 'measured'

  while (attempt <= maxRetries) {
    const call = await completeWithTransportRetry(
      client,
      {
        messages: conversation,
        schema: VIOLATIONS_SCHEMA as unknown as object,
        schemaName: 'conformance_violations',
      },
      options.transportBackoffMs ?? TRANSPORT_BACKOFF_MS,
    )
    transportFailures.push(...call.failures)
    totalLatency += call.latencyMs
    // No response at all: this call was never measured. Leaving the validation loop here is what
    // keeps a dead endpoint out of valid_raw/valid_final.
    if (!call.response) {
      outcome = 'transport_failed'
      break
    }
    const response = call.response
    const latency = call.latencyMs
    totalPromptTokens += response.promptTokens
    totalCompletionTokens += response.completionTokens
    lastRaw = response.text
    // An empty model string means the provider reported no build; keep the requested name only in
    // the legacy aggregate, never in the reported field.
    if (response.model !== '') {
      modelVersion = response.model
      modelVersionReported = response.model
    }
    // Providers that report no backend (Ollama) leave this null; that is data, not a failure.
    providerServed = response.provider ?? null

    const parsed = parseAndFinalize(response.text, context.rules, fact)
    attempts.push({
      attempt_index: attempt,
      tokens_in: response.promptTokens,
      tokens_out: response.completionTokens,
      latency_ms: latency,
      valid: parsed.ok,
      raw_response: response.text,
    })
    if (parsed.ok) {
      violations = parsed.violations
      validFinal = true
      if (attempt === 0) validRaw = true
      break
    }
    // Invalid attempt: feed the errors back and retry (C-2).
    conversation.push({ role: 'user', content: `Your previous response was invalid: ${parsed.errors.join('; ')}. Return valid JSON matching the schema.` })
    attempt++
  }

  const run: RunLog = {
    model_requested: options.modelRequested,
    model_version: modelVersion,
    model_version_reported: modelVersionReported,
    provider_served: providerServed,
    attempts,
    temperature: options.temperature ?? 0,
    seed: options.seed ?? 42,
    run_index: options.runIndex ?? 0,
    tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
    latency_ms: totalLatency,
    // Null, not false, once the transport swallowed the call: claiming the model produced an
    // invalid answer when it was never asked would corrupt the validity rate.
    valid_raw: attempts.length > 0 ? validRaw : null,
    valid_final: outcome === 'measured' ? validFinal : null,
    outcome,
    transport_failures: transportFailures,
    // On exhaustion the loop exits with attempt = maxRetries + 1; clamp so the log never
    // reports more retries than were configured.
    retries: Math.min(attempt, maxRetries),
    prompt_hash: promptHash(initialPrompt),
    raw_response: lastRaw,
  }

  tallyCall(options.tally, fact, run)
  return { violations, checks_performed, run }
}

/**
 * The one place the two failure classes are kept apart. A model that answered but never validly is
 * a measurement failure about the model; a call that never got an answer says nothing about the
 * model at all, so it lands in a different bucket and never touches `invalid`.
 */
function tallyCall(tally: CallTally | undefined, fact: ChangedFact, run: RunLog): void {
  if (!tally) return
  tally.total++
  const call = { file: fact.path, run_index: run.run_index }
  if (run.outcome === 'transport_failed') {
    tally.transportFailed.push(call)
    tally.consecutiveTransportFailures++
    return
  }
  tally.consecutiveTransportFailures = 0
  // Retries that worked in the end are cost information (latency, money), never a measurement error.
  if (run.transport_failures.length > 0) tally.withTransportRetry++
  if (run.valid_final === false) tally.invalid.push(call)
}

interface TransportOutcome {
  /** Null when the transport budget ran out without ever reaching the model. */
  response: LlmResponse | null
  latencyMs: number
  failures: TransportFailure[]
}

/**
 * One model call plus its own retry budget, separate from the validation retries: a rate limit or a
 * dead socket must not consume the attempts that measure whether the model can answer correctly.
 */
async function completeWithTransportRetry(
  client: LlmClient,
  request: LlmRequest,
  backoff: readonly number[],
): Promise<TransportOutcome> {
  const failures: TransportFailure[] = []
  for (let tryIndex = 0; ; tryIndex++) {
    const start = Date.now()
    try {
      const response = await client.complete(request)
      return { response, latencyMs: Date.now() - start, failures }
    } catch (err) {
      if (!(err instanceof TransportError)) throw err
      const latencyMs = Date.now() - start
      failures.push({ kind: err.kind, http_status: err.httpStatus, latency_ms: latencyMs, try_index: tryIndex })
      if (tryIndex >= backoff.length) return { response: null, latencyMs, failures }
      await sleep(
        err.retryAfterMs === null ? backoff[tryIndex] : Math.min(err.retryAfterMs, RETRY_AFTER_CAP_MS),
      )
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type ParseResult =
  | { ok: true; violations: ViolationRecord[] }
  | { ok: false; errors: string[] }

function parseAndFinalize(text: string, rules: readonly ArchitectureRule[], fact: ChangedFact): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['response is not valid JSON'] }
  }
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { violations?: unknown }).violations)) {
    return { ok: false, errors: ['response must be an object with a `violations` array'] }
  }

  const ruleById = new Map(rules.map((r) => [r.id, r]))
  const violations: ViolationRecord[] = []
  const errors: string[] = []

  for (const [i, raw] of (data as { violations: unknown[] }).violations.entries()) {
    const v = raw as Partial<LlmViolation>
    const rule = v.rule_id ? ruleById.get(v.rule_id) : undefined
    if (!rule) {
      errors.push(`violations[${i}]: unknown or missing rule_id "${String(v.rule_id)}"`)
      continue
    }
    const location = {
      file: fact.path,
      module: fact.module,
      component: fact.component,
      ...(v.symbol !== undefined ? { symbol: v.symbol } : {}),
      ...(v.line !== undefined ? { line: v.line } : {}),
    }
    const subject = (v.subject ?? {}) as ViolationSubject
    const record: ViolationRecord = {
      rule_id: rule.id,
      category: rule.category,
      kind: rule.kind,
      source: 'llm',
      location,
      subject,
      reason: v.reason ?? '',
      suggestion: v.suggestion ?? '',
      severity: rule.severity,
      ...(v.confidence !== undefined ? { confidence: v.confidence } : {}),
      match_key: buildMatchKey(rule.category, location, subject),
    }
    const result = validateViolationRecord(record)
    if (!result.valid) errors.push(`violations[${i}]: ${result.errors.join(', ')}`)
    else violations.push(record)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, violations }
}
