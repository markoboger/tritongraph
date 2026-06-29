import type { ArchitectureRule, RulePredicate } from './types'

/**
 * Validate a parsed `architecture-rules.yaml` (spec §3.1b) into typed rules.
 *
 * Takes the already-parsed object (`yaml.load(text)`), not raw text, so the package stays
 * dependency-free. Throws on malformed input with a field-level message — rules are authored Soll
 * input, so failing loudly at load time is correct (unlike LLM output, which retries; see C-2).
 */
export function parseArchitectureRules(raw: unknown): ArchitectureRule[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { rules?: unknown }).rules)) {
    throw new Error('architecture-rules: expected an object with a `rules` array')
  }
  return (raw as { rules: unknown[] }).rules.map((rule, i) => parseRule(rule, i))
}

function parseRule(raw: unknown, index: number): ArchitectureRule {
  const at = `rules[${index}]`
  if (typeof raw !== 'object' || raw === null) throw new Error(`${at}: must be an object`)
  const r = raw as Record<string, unknown>

  const str = (key: string): string => {
    const v = r[key]
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`${at}.${key}: required non-empty string`)
    return v
  }

  const kind = str('kind')
  if (kind !== 'structural' && kind !== 'semantic') throw new Error(`${at}.kind: must be structural|semantic`)
  const severity = str('severity')
  if (severity !== 'error' && severity !== 'warning') throw new Error(`${at}.severity: must be error|warning`)

  const scope = r.scope as { components?: unknown } | undefined
  if (typeof scope !== 'object' || scope === null || !isStringArray(scope.components)) {
    throw new Error(`${at}.scope.components: required string array`)
  }

  return {
    id: str('id'),
    category: str('category'),
    kind,
    severity,
    statement: str('statement'),
    scope: { components: scope.components },
    predicate: parsePredicate(r.predicate, at),
  }
}

function parsePredicate(raw: unknown, at: string): RulePredicate | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') throw new Error(`${at}.predicate: must be an object`)
  const p = raw as Record<string, unknown>
  if (p.type !== 'import-boundary') throw new Error(`${at}.predicate.type: unsupported "${String(p.type)}"`)
  if (!isStringArray(p.allowed_importers)) throw new Error(`${at}.predicate.allowed_importers: required string array`)
  return { type: 'import-boundary', allowed_importers: p.allowed_importers }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string')
}
