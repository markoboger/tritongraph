import type { ChatMessage } from './contextBuilder'
import type { TransportFailureKind } from './types'

/**
 * Thin OpenAI-compatible client (C-4: provider interface, model swappable by config). Structured
 * JSON output is mandatory (C-1). Uses global `fetch` so it runs in Node 18+ and the browser, but
 * the API key must only be supplied server-side (CLI / runtime server), never in the editor.
 *
 * Logging fields mirror the Python extractor's run_logger 1:1 so check and extraction measurements
 * stay comparable (C-6) — that comparability comes from the identical schema, not shared code.
 */
export interface LlmRequest {
  messages: ChatMessage[]
  /** JSON schema the response must conform to (response_format json_schema). */
  schema: object
  schemaName: string
}

export interface LlmResponse {
  text: string
  /** Delivered build, kept separate from the requested name (C-6). */
  model: string
  promptTokens: number
  completionTokens: number
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>
}

export interface OpenAiClientOptions {
  /** e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1 */
  baseUrl: string
  apiKey: string
  model: string
  /** Default 0 (C-5). */
  temperature?: number
  /** Default 42 (C-5: seed set, but variance is measured, not assumed). */
  seed?: number
  /** Per-call budget; the call is aborted when it is used up. Default DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number
}

/** Per model call, not per file and not per run. */
export const DEFAULT_TIMEOUT_MS = 120_000

/**
 * The provider never delivered a usable response — timeout, dead socket, rate limit, server error.
 *
 * This is NOT a validation failure and must never be counted as one: the validity rate is a
 * measurement of what the model can do, and folding transport trouble into it would silently turn
 * it into a measurement of the infrastructure. Other HTTP errors (401, 404, 400) stay ordinary
 * Errors — those are configuration mistakes, and retrying them only wastes time.
 */
export class TransportError extends Error {
  constructor(
    readonly kind: TransportFailureKind,
    readonly httpStatus: number | null,
    /** From a `Retry-After` header, already in milliseconds; null when the provider gave none. */
    readonly retryAfterMs: number | null,
    message: string,
  ) {
    super(message)
    this.name = 'TransportError'
  }
}

export function createOpenAiClient(options: OpenAiClientOptions): LlmClient {
  const { baseUrl, apiKey, model, temperature = 0, seed = 42, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
      // The abort surfaces as a normal rejected promise, never as a hard process exit: a run that
      // skipped its finally chain would leave a header without a footer, which the analysis reads
      // as a dead process rather than as a timeout.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: request.messages,
            temperature,
            seed,
            response_format: {
              type: 'json_schema',
              json_schema: { name: request.schemaName, schema: request.schema, strict: true },
            },
          }),
          signal: controller.signal,
        })
        if (response.status === 429) {
          throw new TransportError('http_429', 429, retryAfterMs(response), 'LLM request rate limited: 429')
        }
        if (response.status >= 500) {
          throw new TransportError('http_5xx', response.status, null, `LLM request failed upstream: ${response.status}`)
        }
        if (!response.ok) {
          throw new Error(`LLM request failed: ${response.status} ${response.statusText} ${await response.text()}`)
        }
        const data = (await response.json()) as {
          model?: string
          choices?: { message?: { content?: string } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        return {
          text: data.choices?.[0]?.message?.content ?? '',
          // Empty when the provider reported no build — the run log must not pass off the requested
          // name as the delivered one.
          model: data.model ?? '',
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
        }
      } catch (err) {
        throw classifyCallError(err, controller.signal.aborted, timeoutMs)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** An aborted call and a dead connection are transport; everything else keeps the class it had. */
function classifyCallError(err: unknown, aborted: boolean, timeoutMs: number): unknown {
  if (err instanceof TransportError) return err
  if (aborted) return new TransportError('timeout', null, null, `no response within ${timeoutMs} ms`)
  // fetch rejects with a TypeError when the connection itself failed; a JSON parse error does not.
  if (err instanceof TypeError) return new TransportError('network', null, null, err.message)
  return err
}

/** `Retry-After` in seconds. ponytail: the HTTP-date form is ignored, no provider we use sends it. */
function retryAfterMs(response: { headers: { get(name: string): string | null } }): number | null {
  const raw = response.headers.get('retry-after')
  if (raw === null) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

/** JSON schema for the model's violation output. We add `source` and `match_key` ourselves. */
export const VIOLATIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['violations'],
  properties: {
    violations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule_id', 'subject', 'reason', 'suggestion'],
        properties: {
          rule_id: { type: 'string' },
          symbol: { type: 'string' },
          line: { type: 'number' },
          subject: {
            type: 'object',
            additionalProperties: false,
            properties: {
              offending_type: { type: 'string' },
              via: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
            },
          },
          reason: { type: 'string' },
          suggestion: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const

/** Stable non-crypto hash (FNV-1a) for prompt identification in the run log. No deps. */
export function promptHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
