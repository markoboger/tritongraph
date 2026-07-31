import type {
  ArchitectureRule,
  ChangedFact,
  CheckPerformed,
  RunAttempt,
  RunLog,
  SollModel,
  ViolationRecord,
  ViolationSubject,
} from './types'
import { buildMatchKey } from './matchKey'
import { validateViolationRecord } from './validate'
import { buildMessages, buildPromptContext, type ChatMessage } from './contextBuilder'
import { VIOLATIONS_SCHEMA, promptHash, type LlmClient } from './llmClient'

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
  let violations: ViolationRecord[] = []
  let validFinal = false
  const attempts: RunAttempt[] = []
  const conversation: ChatMessage[] = [...messages]

  while (attempt <= maxRetries) {
    const start = Date.now()
    const response = await client.complete({
      messages: conversation,
      schema: VIOLATIONS_SCHEMA as unknown as object,
      schemaName: 'conformance_violations',
    })
    const latency = Date.now() - start
    totalLatency += latency
    totalPromptTokens += response.promptTokens
    totalCompletionTokens += response.completionTokens
    lastRaw = response.text
    // An empty model string means the provider reported no build; keep the requested name only in
    // the legacy aggregate, never in the reported field.
    if (response.model !== '') {
      modelVersion = response.model
      modelVersionReported = response.model
    }

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
    attempts,
    temperature: options.temperature ?? 0,
    seed: options.seed ?? 42,
    run_index: options.runIndex ?? 0,
    tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
    latency_ms: totalLatency,
    valid_raw: validRaw,
    valid_final: validFinal,
    // On exhaustion the loop exits with attempt = maxRetries + 1; clamp so the log never
    // reports more retries than were configured.
    retries: Math.min(attempt, maxRetries),
    prompt_hash: promptHash(initialPrompt),
    raw_response: lastRaw,
  }

  return { violations, checks_performed, run }
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
