/**
 * Increment 6 check: the core check() combines rule-engine + LLM per file, and the reporter formats
 * + sets the exit code. No network (LLM injected).
 */
import { describe, it, expect } from 'vitest'
import { check } from '../../../packages/triton-conformance/src/check'
import { observedImportsFromFacts } from '../../../packages/triton-conformance/src/ruleEngine'
import { exitCode, formatReport, allViolations } from '../../../packages/triton-conformance/src/reporter'
import type { LlmClient } from '../../../packages/triton-conformance/src/llmClient'
import { sollModel, changedFacts } from '../../../packages/triton-conformance/fixtures/miniRepo'

const observedImports = observedImportsFromFacts(changedFacts)

/** Fake client that returns the framework-leak only for the pricing file, else no violations. */
const leakForPricing: LlmClient = {
  async complete(req) {
    const prompt = req.messages.map((m) => m.content).join('\n')
    const violations = prompt.includes('app.domain.pricing')
      ? [
          {
            rule_id: 'no-domain-framework-coupling',
            symbol: 'quote',
            subject: { offending_type: 'flask.Request', via: 'signature' },
            reason: 'Domain signature references a web-framework type.',
            suggestion: 'Use a plain DTO.',
          },
        ]
      : []
    return { text: JSON.stringify({ violations }), model: 'fake', promptTokens: 1, completionTokens: 1 }
  },
}

describe('check (rule-engine only)', () => {
  it('reports the forbidden edge on the offending file and nothing on clean files', async () => {
    const results = await check({ soll: sollModel, changedFacts, observedImports })
    const all = allViolations(results)
    expect(all).toHaveLength(1)
    expect(all[0].rule_id).toBe('DERIVED:forbidden-edge')
    expect(all[0].location.file).toBe('app/domain/order.py')
  })
})

describe('check (rule-engine + LLM)', () => {
  it('combines structural and semantic findings, each tagged by source', async () => {
    const results = await check({
      soll: sollModel,
      changedFacts,
      observedImports,
      llm: { client: leakForPricing, options: { modelRequested: 'm' } },
    })
    const all = allViolations(results)
    const sources = all.map((v) => `${v.source}:${v.category}`).sort()
    expect(sources).toEqual(['llm:semantic-framework-leak', 'rule-engine:layer-violation'])
  })

  it('attaches a run log only to files where the LLM ran (rules in scope)', async () => {
    const results = await check({
      soll: sollModel,
      changedFacts,
      observedImports,
      llm: { client: leakForPricing, options: { modelRequested: 'm' } },
    })
    // routes.py (api) has no rules in scope → no run; domain files have one.
    const runs = results.filter((r) => r.run !== undefined)
    expect(runs.length).toBe(2)
  })
})

describe('reporter', () => {
  it('exit code is non-zero with an error violation, zero when clean', async () => {
    const dirty = await check({ soll: sollModel, changedFacts, observedImports })
    expect(exitCode(dirty)).toBe(1)
    expect(exitCode([{ violations: [], checks_performed: [] }])).toBe(0)
  })

  it('warnings alone do not fail the build', () => {
    const warnOnly = [
      {
        violations: [
          {
            rule_id: 'r',
            category: 'c',
            kind: 'structural' as const,
            source: 'rule-engine' as const,
            location: { file: 'a.py', module: 'a', component: 'x' },
            subject: { from: 'x', to: 'y' },
            reason: 'r',
            suggestion: 's',
            severity: 'warning' as const,
            match_key: 'c|x|a|x->y',
          },
        ],
        checks_performed: [],
      },
    ]
    expect(exitCode(warnOnly)).toBe(0)
  })

  it('formats a grouped, human-readable report', async () => {
    const results = await check({ soll: sollModel, changedFacts, observedImports })
    const report = formatReport(results)
    expect(report).toContain('app/domain/order.py')
    expect(report).toContain('[error] layer-violation')
    expect(report).toContain('fix:')
  })

  it('reports OK when there are no violations', () => {
    expect(formatReport([{ violations: [], checks_performed: [] }])).toBe('Conformance OK — no violations.')
  })
})
