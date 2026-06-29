import type { ViolationRecord } from './types'
import { matchKeyOf } from './matchKey'

/**
 * Runtime validator for a violation record. Used in two places:
 *  - Increment 1: assert hand-written fixture records conform to the contract.
 *  - Increment 5: validate LLM output; a failure is an invalid attempt → retry, never a crash (C-2).
 *
 * Hand-rolled guards (no schema dependency) — the contract is small and stable.
 */
export interface ValidationResult {
  valid: boolean
  errors: readonly string[]
}

const SEVERITIES = new Set(['error', 'warning'])
const KINDS = new Set(['structural', 'semantic'])
const SOURCES = new Set(['rule-engine', 'llm'])

export function validateViolationRecord(value: unknown): ValidationResult {
  const errors: string[] = []
  const push = (m: string) => errors.push(m)

  if (typeof value !== 'object' || value === null) {
    return { valid: false, errors: ['violation is not an object'] }
  }
  const v = value as Record<string, unknown>

  const nonEmptyString = (key: string) => {
    if (typeof v[key] !== 'string' || (v[key] as string).trim() === '') push(`${key} must be a non-empty string`)
  }

  nonEmptyString('rule_id')
  nonEmptyString('category')
  // reason AND suggestion are both mandatory per spec §4 (Violation + Begründung + Vorschlag).
  nonEmptyString('reason')
  nonEmptyString('suggestion')

  if (!KINDS.has(v.kind as string)) push(`kind must be one of ${[...KINDS].join('|')}`)
  if (!SOURCES.has(v.source as string)) push(`source must be one of ${[...SOURCES].join('|')}`)
  if (!SEVERITIES.has(v.severity as string)) push(`severity must be one of ${[...SEVERITIES].join('|')}`)

  const loc = v.location as Record<string, unknown> | undefined
  if (typeof loc !== 'object' || loc === null) {
    push('location must be an object')
  } else {
    if (typeof loc.file !== 'string' || loc.file === '') push('location.file must be a non-empty string')
    if (typeof loc.module !== 'string' || loc.module === '') push('location.module must be a non-empty string')
    if (!('component' in loc)) push('location.component must be present (string or null)')
  }

  const subj = v.subject as Record<string, unknown> | undefined
  if (typeof subj !== 'object' || subj === null) {
    push('subject must be an object')
  } else {
    const hasType = typeof subj.offending_type === 'string' && subj.offending_type !== ''
    const hasEdge = typeof subj.from === 'string' && typeof subj.to === 'string'
    if (!hasType && !hasEdge) push('subject must carry offending_type or from/to')
  }

  if (v.confidence !== undefined) {
    if (typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1) {
      push('confidence, when present, must be a number in [0,1]')
    }
  }

  // match_key must be self-consistent with (category, location, subject) so the eval join is exact.
  if (errors.length === 0) {
    const expected = matchKeyOf(v as unknown as ViolationRecord)
    if (v.match_key !== expected) push(`match_key "${String(v.match_key)}" does not match expected "${expected}"`)
  }

  return { valid: errors.length === 0, errors }
}
