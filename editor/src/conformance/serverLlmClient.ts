import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'

/**
 * Browser LlmClient that routes through the runtime server's /api/conformance/llm proxy, so the API
 * key stays server-side and never enters the browser. All other conformance logic (context build,
 * retry-as-invalid, finalize) runs locally in the editor against this client.
 */
export function createServerLlmClient(runtimeBaseUrl: string): LlmClient {
  return {
    async complete(request) {
      const res = await fetch(`${runtimeBaseUrl.replace(/\/$/, '')}/api/conformance/llm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: request.messages,
          schema: request.schema,
          schemaName: request.schemaName,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(`conformance LLM proxy failed: ${data?.error ?? res.status}`)
      }
      return {
        text: data.text,
        model: data.model,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
      }
    },
  }
}
