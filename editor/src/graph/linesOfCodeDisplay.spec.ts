import { describe, expect, it } from 'vitest'
import {
  artefactSubtitleSansMetrics,
  formatLinesOfCodeUnit,
  innerArtefactRowSubtitle,
  metricsSuffixFromArtefactSubtitle,
  physicalLineSpanInclusive,
  sumPhysicalLinesForPaths,
  totalMainScalaPhysicalLines,
} from './linesOfCodeDisplay'

describe('linesOfCodeDisplay', () => {
  it('artefactSubtitleSansMetrics strips trailing loc/kloc only', () => {
    expect(artefactSubtitleSansMetrics('class, 10 loc')).toBe('class')
    expect(artefactSubtitleSansMetrics('case class, 1.5 kloc')).toBe('case class')
    expect(artefactSubtitleSansMetrics('trait')).toBe('trait')
    expect(artefactSubtitleSansMetrics('function')).toBe('function')
  })

  it('metricsSuffixFromArtefactSubtitle returns only the metrics tail', () => {
    expect(metricsSuffixFromArtefactSubtitle('class, 146 loc')).toBe(', 146 loc')
    expect(metricsSuffixFromArtefactSubtitle('case class, 1.5 kloc')).toBe(', 1.5 kloc')
    expect(metricsSuffixFromArtefactSubtitle('trait')).toBe('')
  })

  it('innerArtefactRowSubtitle keeps declaration and appends loc from subtitle or rows', () => {
    expect(
      innerArtefactRowSubtitle({
        declaration: 'trait Bird',
        subtitle: 'trait, 12 loc',
      }),
    ).toBe('trait Bird, 12 loc')
    expect(
      innerArtefactRowSubtitle({
        declaration: 'trait Bird',
        subtitle: 'trait',
        sourceRow: 0,
        sourceEndRow: 11,
      }),
    ).toBe('trait Bird, 12 loc')
    expect(innerArtefactRowSubtitle({ declaration: '', subtitle: 'object, 3 loc' })).toBe('object, 3 loc')
  })

  it('physicalLineSpanInclusive is end-inclusive on 0-indexed rows', () => {
    expect(physicalLineSpanInclusive(0, 0)).toBe(1)
    expect(physicalLineSpanInclusive(2, 5)).toBe(4)
    expect(physicalLineSpanInclusive(3, 1)).toBe(0)
  })

  it('formatLinesOfCodeUnit uses loc below 1000 and kloc at/above 1000', () => {
    expect(formatLinesOfCodeUnit(0)).toBe('0 loc')
    expect(formatLinesOfCodeUnit(42)).toBe('42 loc')
    expect(formatLinesOfCodeUnit(999)).toBe('999 loc')
    expect(formatLinesOfCodeUnit(1000)).toBe('1 kloc')
    expect(formatLinesOfCodeUnit(1500)).toBe('1.5 kloc')
    expect(formatLinesOfCodeUnit(10000)).toBe('10 kloc')
  })

  it('sumPhysicalLinesForPaths sums known paths only', () => {
    const counts = { a: 10, b: 5 }
    expect(sumPhysicalLinesForPaths(['a', 'b', 'missing'], counts)).toBe(15)
    expect(sumPhysicalLinesForPaths(['a'], undefined)).toBe(0)
  })

  it('totalMainScalaPhysicalLines skips src/test and counts newlines', () => {
    expect(
      totalMainScalaPhysicalLines([
        { relPath: 'mod/src/main/scala/A.scala', source: 'a\nb\nc' },
        { relPath: 'mod/src/test/scala/T.scala', source: 'x\ny' },
      ]),
    ).toBe(3)
    expect(totalMainScalaPhysicalLines([])).toBe(0)
  })
})
