/**
 * Increment 5 check: the LLM-checker loop around an injected fake client — context slicing, valid
 * output → finalized violations, retry-as-invalid (C-2), and the no-rules-in-scope skip. No network.
 */
import { describe, it, expect } from 'vitest'
import { buildPromptContext } from '../../../packages/triton-conformance/src/contextBuilder'
import { checkFactWithLlm } from '../../../packages/triton-conformance/src/llmChecker'
import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'
import { sollModel, changedFacts, expectedViolations } from '../../../packages/triton-conformance/fixtures/miniRepo'

const pricingFact = changedFacts[1] // domain, has the framework-leak rule in scope
const routesFact = changedFacts[2] // api, no rules in scope

/** Fake client that replays canned responses; counts calls. */
function fakeClient(responses: string[]): { client: LlmClient; calls: () => number } {
  let calls = 0
  const client: LlmClient = {
    async complete() {
      const text = responses[Math.min(calls, responses.length - 1)]
      calls++
      return { text, model: 'fake-model-build-123', promptTokens: 10, completionTokens: 5 }
    },
  }
  return { client, calls: () => calls }
}

const validResponse = JSON.stringify({
  violations: [
    {
      rule_id: 'no-domain-framework-coupling',
      symbol: 'quote',
      line: 5,
      subject: { offending_type: 'flask.Request', via: 'signature' },
      reason: 'Parameter req is typed flask.Request; the domain layer references a web-framework concept.',
      suggestion: 'Accept a plain DTO; map the request in the api layer.',
      confidence: 0.82,
    },
  ],
})

describe('buildPromptContext', () => {
  it('selects the in-scope rule for a domain file', () => {
    const ctx = buildPromptContext(sollModel, pricingFact)
    expect(ctx.rules.map((r) => r.id)).toEqual(['no-domain-framework-coupling'])
  })

  it('selects no rules for an api file (rule is scoped to domain)', () => {
    expect(buildPromptContext(sollModel, routesFact).rules).toEqual([])
  })
})

describe('checkFactWithLlm', () => {
  it('finalizes a valid response into a matching violation; valid_raw on first try', async () => {
    const { client, calls } = fakeClient([validResponse])
    const out = await checkFactWithLlm(pricingFact, sollModel, client, { modelRequested: 'm' })
    expect(calls()).toBe(1)
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0].source).toBe('llm')
    expect(out.violations[0].match_key).toBe(expectedViolations[1].match_key)
    expect(out.violations[0].category).toBe('semantic-framework-leak') // filled from the rule, not the model
    expect(out.run?.valid_raw).toBe(true)
    expect(out.run?.valid_final).toBe(true)
    expect(out.run?.retries).toBe(0)
    expect(out.run?.model_version).toBe('fake-model-build-123')
  })

  it('retries an invalid response, then succeeds (valid_raw false, valid_final true)', async () => {
    const { client, calls } = fakeClient(['not json', validResponse])
    const out = await checkFactWithLlm(pricingFact, sollModel, client, { modelRequested: 'm' })
    expect(calls()).toBe(2)
    expect(out.run?.valid_raw).toBe(false)
    expect(out.run?.valid_final).toBe(true)
    expect(out.run?.retries).toBe(1)
    expect(out.violations).toHaveLength(1)
  })

  it('never crashes when every attempt is invalid; valid_final false, no violations', async () => {
    const { client, calls } = fakeClient(['nope'])
    const out = await checkFactWithLlm(pricingFact, sollModel, client, { modelRequested: 'm', maxRetries: 2 })
    expect(calls()).toBe(3) // initial + 2 retries
    expect(out.run?.valid_final).toBe(false)
    // Exhaustion must report the configured retry count, not attempts (maxRetries + 1).
    expect(out.run?.retries).toBe(2)
    expect(out.violations).toEqual([])
  })

  it('rejects a violation referencing an unknown rule_id (retryable)', async () => {
    const bad = JSON.stringify({ violations: [{ rule_id: 'made-up', subject: { offending_type: 'x' }, reason: 'r', suggestion: 's' }] })
    const { client } = fakeClient([bad])
    const out = await checkFactWithLlm(pricingFact, sollModel, client, { modelRequested: 'm', maxRetries: 0 })
    expect(out.run?.valid_final).toBe(false)
    expect(out.violations).toEqual([])
  })

  it('skips the LLM call entirely when no rules are in scope', async () => {
    const { client, calls } = fakeClient([validResponse])
    const out = await checkFactWithLlm(routesFact, sollModel, client, { modelRequested: 'm' })
    expect(calls()).toBe(0)
    expect(out.run).toBeUndefined()
    expect(out.violations).toEqual([])
    expect(out.checks_performed).toEqual([])
  })
})
