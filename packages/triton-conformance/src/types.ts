/**
 * Data contracts for the conformance checker (spec §3.1–3.4).
 *
 * The checker validates code against a given target architecture ("Soll-Modell") and reports
 * violations. These types are the contract every component agrees on: AST-extractor, rule-engine,
 * LLM-checker, reporter, and the eval harness all read/write the same shapes.
 *
 * Deliberately framework-free and Node-capable: this package is consumed natively by the editor
 * (Vite) and by the runtime server (the thin deployment shape), and run standalone by the CLI
 * (the measurement core).
 */

// ── Soll-Modell: rules (§3.1b) ───────────────────────────────────────────────

export type RuleKind = 'structural' | 'semantic'
export type Severity = 'error' | 'warning'

export interface RuleScope {
  /** Components this rule applies to, by name (must exist in the resolved topology). */
  components: readonly string[]
}

/**
 * Optional machine-checkable predicate. `structural` rules with a predicate can be evaluated by the
 * deterministic rule-engine; `semantic` rules without one are judged by the LLM against `statement`.
 */
export interface ImportBoundaryPredicate {
  type: 'import-boundary'
  /** Only these modules/components may import into the rule's scope. */
  allowed_importers: readonly string[]
}

export type RulePredicate = ImportBoundaryPredicate

export interface ArchitectureRule {
  id: string
  /** Must match exactly one of the eval's injected-violation categories (§7). */
  category: string
  kind: RuleKind
  scope: RuleScope
  /** Human-readable specification; the spec the LLM judges `semantic` rules against. */
  statement: string
  severity: Severity
  predicate?: RulePredicate
}

// ── Soll-Modell: resolved topology (§3.1a) ───────────────────────────────────

/** Allowed dependency edge between two components. Anything not listed is forbidden. */
export interface AllowedEdge {
  from: string
  to: string
}

/**
 * The Ilograph topology compiled into the lookups the checker needs. Produced by the topology
 * reader (Increment 2) from `resources` (module→component) and `perspectives[].relations`
 * (allowed edges); the fixture provides it directly so contracts can be tested before that reader
 * exists.
 */
export interface ResolvedTopology {
  /** Dotted module path → owning component name. Unmapped modules resolve to null at lookup time. */
  moduleToComponent: Readonly<Record<string, string>>
  components: readonly string[]
  allowedEdges: readonly AllowedEdge[]
}

export interface SollModel {
  topology: ResolvedTopology
  rules: readonly ArchitectureRule[]
}

// ── changed_facts: output of the AST-extractor (§3.2) ────────────────────────

export type DiffKind = 'added' | 'modified'

export interface FactImport {
  target: string
  /** Resolved owning component, or null for external/unmapped targets. */
  target_component: string | null
}

export interface FactParam {
  name: string
  /** Type annotation as written, or null when absent. Semantically relevant (e.g. framework leak). */
  annotation: string | null
}

export interface FactSignature {
  symbol: string
  kind: 'function' | 'method' | 'class'
  params: readonly FactParam[]
  returns: string | null
}

export interface ChangedFact {
  path: string
  module: string
  /** Owning component via module→component map; null = unmapped (itself flaggable). */
  component: string | null
  diff_kind: DiffKind
  imports: readonly FactImport[]
  signatures: readonly FactSignature[]
}

// ── Violation record: checker output (§3.3) ──────────────────────────────────

export type ViolationSource = 'rule-engine' | 'llm'

export interface ViolationLocation {
  file: string
  module: string
  component: string | null
  symbol?: string
  line?: number
}

/**
 * What is offending. Either a type referenced via a signature/import (`offending_type` + `via`),
 * or a forbidden edge between components (`from`/`to`).
 */
export interface ViolationSubject {
  offending_type?: string
  via?: 'signature' | 'import' | string
  from?: string
  to?: string
}

export interface ViolationRecord {
  /** Rule id, or "DERIVED:forbidden-edge" / "DERIVED:cycle" for rule-engine findings. */
  rule_id: string
  category: string
  kind: RuleKind
  source: ViolationSource
  location: ViolationLocation
  subject: ViolationSubject
  reason: string
  suggestion: string
  severity: Severity
  /** Model-asserted soft signal only. NOT a metric (Guardrail C-9). */
  confidence?: number
  /** Normalized from (category, location, subject) for the eval join. See buildMatchKey. */
  match_key: string
}

// ── CheckResult / Run-Log (§3.4) ─────────────────────────────────────────────

export interface CheckPerformed {
  rule_id: string
  scope: RuleScope
  source: ViolationSource
}

/** One model call inside a run: the retry loop keeps every attempt, not just the aggregate (C-6). */
export interface RunAttempt {
  /** 0-based position in the retry loop. */
  attempt_index: number
  tokens_in: number
  tokens_out: number
  latency_ms: number
  /** Did this attempt parse and validate? */
  valid: boolean
  /** Raw text of this attempt, kept even when it was discarded as invalid. */
  raw_response: string
}

/**
 * Why a model call never produced a usable HTTP response. Deliberately separate from a validation
 * failure: the validity rate is a measurement of what the model can do, and counting a dead socket
 * or a rate limit into it would turn it into a measurement of the infrastructure instead.
 */
export type TransportFailureKind = 'timeout' | 'network' | 'http_429' | 'http_5xx'

/** One failed transport try, successful retries included — those are cost, not measurement error. */
export interface TransportFailure {
  kind: TransportFailureKind
  /** HTTP status when there was one; null for timeouts and network errors. */
  http_status: number | null
  latency_ms: number
  /** 0-based try within this call's transport-retry budget. */
  try_index: number
}

/** Did this call get a model answer at all? `transport_failed` means: not measured. */
export type CallOutcome = 'measured' | 'transport_failed'

/** Full per-run log (C-6). Present for LLM checks; rule-engine-only results omit it. */
export interface RunLog {
  /** Requested model name. */
  model_requested: string
  /** Delivered build, kept separate from the requested name (C-6). */
  model_version: string
  /**
   * The build string the provider actually reported, or null when it reported none. Unlike
   * `model_version` this is never backfilled from the requested name.
   */
  model_version_reported: string | null
  /**
   * Backend that served the call, as reported by the provider; null when it reported none. Requested
   * routing lives in the run header (provider_pin) — asked for is not the same as served.
   */
  provider_served?: string | null
  /** Every attempt of the retry loop, in order. */
  attempts: readonly RunAttempt[]
  temperature: number
  seed: number
  run_index: number
  tokens: { prompt: number; completion: number }
  latency_ms: number
  /** Did the first raw response parse/validate? (C-2) Null when no response was ever received. */
  valid_raw: boolean | null
  /**
   * Did the final response (after retries) validate? (C-2) Null — never false — when the call ended
   * in a transport failure: false would claim the model failed, and it never got the question.
   */
  valid_final: boolean | null
  outcome: CallOutcome
  /** Every failed transport try of this call, in order. Empty when the transport was clean. */
  transport_failures: readonly TransportFailure[]
  retries: number
  prompt_hash: string
  raw_response: string
}

export interface CheckResult {
  /** File this result belongs to. Absent only for results not tied to a single file. */
  file?: string
  /** Python module path of `file`; absent for results built from structural findings alone. */
  module?: string
  violations: readonly ViolationRecord[]
  /**
   * Which rule×scope was actually evaluated. NOT the recall denominator, but separates
   * "checked & ok" from "out of scope" (coverage gap, §3.4).
   */
  checks_performed: readonly CheckPerformed[]
  run?: RunLog
}
