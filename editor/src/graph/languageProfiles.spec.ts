import { describe, expect, it } from 'vitest'
import { GENERIC_PROFILE, languageProfile } from './languageProfiles'

describe('languageProfile', () => {
  it('resolves Scala with Scala-specific wording and per-kind icons', () => {
    const p = languageProfile('scala')
    expect(p.id).toBe('scala')
    expect(p.shikiLang).toBe('scala')
    expect(p.argumentsLabel).toBe('Constructors')
    expect(p.docEmpty).toMatch(/scaladoc/i)
    expect(p.specsEmpty).toMatch(/sbt test/i)
    // Scala overrides per-kind glyphs, so a class and a trait get distinct icons.
    expect(p.kindIconUrl('class')).not.toBe(p.kindIconUrl('trait'))
  })

  it('resolves Python with docstring/pytest wording and the Python logo for every kind', () => {
    const p = languageProfile('python')
    expect(p.id).toBe('python')
    expect(p.shikiLang).toBe('python')
    expect(p.argumentsLabel).toBe('Parameters')
    expect(p.methodsLabel).toBe('Methods')
    expect(p.docEmpty).toMatch(/docstring/i)
    expect(p.specsEmpty).toMatch(/pytest/i)
    // No per-kind glyph set for Python — every kind falls back to the language logo.
    expect(p.kindIconUrl('class')).toBe(p.logoUrl)
    expect(p.kindIconUrl('function')).toBe(p.logoUrl)
  })

  it('treats LanguageIconId aliases (ts/js) as their canonical language', () => {
    expect(languageProfile('ts').id).toBe('typescript')
    expect(languageProfile('js').id).toBe('javascript')
  })

  it('falls back to the generic profile for unknown / missing languages', () => {
    expect(languageProfile('cobol')).toBe(GENERIC_PROFILE)
    expect(languageProfile(undefined)).toBe(GENERIC_PROFILE)
    expect(languageProfile('')).toBe(GENERIC_PROFILE)
    expect(GENERIC_PROFILE.shikiLang).toBe('text')
  })

  it('maps common kinds to single-letter badges and degrades gracefully', () => {
    const p = languageProfile('scala')
    expect(p.kindBadge('class')).toBe('C')
    expect(p.kindBadge('trait')).toBe('T')
    expect(p.kindBadge('object')).toBe('O')
    expect(p.kindBadge('function')).toBe('ƒ')
    // Unknown kind → first uppercased letter rather than a crash or empty badge.
    expect(p.kindBadge('widget')).toBe('W')
    expect(p.kindBadge('')).toBe('?')
  })
})
