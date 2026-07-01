import { describe, expect, it } from 'vitest'
import { splitViolationsByHistory } from './violationHistory'
import type { ViolationRecord } from '../../../packages/triton-conformance/src/types'

function v(match_key: string): ViolationRecord {
  return { match_key } as unknown as ViolationRecord
}

describe('splitViolationsByHistory', () => {
  it('classifies added (head-only), legacy (both), and fixed (base-only) by match_key', () => {
    const base = [v('shared'), v('gone')]
    const head = [v('shared'), v('new')]
    const { added, legacy, fixed } = splitViolationsByHistory(head, base)

    expect(added.map((x) => x.match_key)).toEqual(['new'])
    expect(legacy.map((x) => x.match_key)).toEqual(['shared'])
    expect(fixed.map((x) => x.match_key)).toEqual(['gone'])
  })
})
