import type { ChatMessage } from './contextBuilder'

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
}

export function createOpenAiClient(options: OpenAiClientOptions): LlmClient {
  const { baseUrl, apiKey, model, temperature = 0, seed = 42 } = options
  return {
    async complete(request: LlmRequest): Promise<LlmResponse> {
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
      })
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
        model: data.model ?? model,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      }
    },
  }
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
