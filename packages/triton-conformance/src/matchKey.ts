import type { ViolationRecord, ViolationSubject, ViolationLocation } from './types'

/**
 * Deterministic join key from (category, location, subject) — spec §3.3.
 *
 * The eval harness joins flagged ↔ injected violations on this key WITHOUT fuzzy matching, so it
 * must be stable and order-free. Same discipline as name normalization on the extraction side.
 *
 * Shape: `category|component|module|subjectKey`
 *   - subjectKey = `offending_type` (type referenced via signature/import), or
 *     `from->to` (forbidden edge), or '' when neither is set.
 *
 * Example (from the spec):
 *   semantic-framework-leak | domain | app.domain.order | flask.Request
 */
export function buildMatchKey(
  category: string,
  location: Pick<ViolationLocation, 'component' | 'module'>,
  subject: ViolationSubject,
): string {
  // `||` not `??`: an empty-string offending_type (which validation allows next to a valid
  // from/to edge) must fall through to the edge key, not erase it.
  const subjectKey =
    subject.offending_type ||
    (subject.from != null && subject.to != null ? `${subject.from}->${subject.to}` : '')
  return [category, location.component ?? '', location.module, subjectKey].join('|')
}

/** Recompute the match_key a record should carry (used to verify a record is self-consistent). */
export function matchKeyOf(v: Pick<ViolationRecord, 'category' | 'location' | 'subject'>): string {
  return buildMatchKey(v.category, v.location, v.subject)
}
