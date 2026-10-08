import { expect, it } from 'vitest'
import { diffRangeFor, diffRangeLabel, setDiffRange } from './diffRange'

it('editing a returned range does not change the applied one until it is set', () => {
  setDiffRange('/repo', { base: 'main', head: 'feature', mode: 'merge-base' })
  const draft = diffRangeFor('/repo')
  draft.head = 'half-typ'
  expect(diffRangeFor('/repo').head).toBe('feature')
})

it('labels the two range kinds the way git spells them', () => {
  expect(diffRangeLabel({ base: 'main', head: 'x', mode: 'merge-base' })).toBe('main…x')
  expect(diffRangeLabel({ base: 'main', head: '', mode: 'direct' })).toBe('main..working tree')
})
