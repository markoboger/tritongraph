import { describe, expect, it } from 'vitest'
import { computeSbtProjectScalaLineCounts, owningSbtProjectIdForFile } from './sbtProjectLineCounts'

describe('sbtProjectLineCounts', () => {
  const projects = [
    { id: 'root', baseDir: '.' },
    { id: 'animals', baseDir: 'animals' },
    { id: 'fruit', baseDir: 'fruit' },
  ] as const

  it('owningSbtProjectIdForFile prefers longest baseDir prefix', () => {
    expect(owningSbtProjectIdForFile('animals/src/main/scala/X.scala', projects)).toBe('animals')
    expect(owningSbtProjectIdForFile('fruit/Foo.scala', projects)).toBe('fruit')
  })

  it('owningSbtProjectIdForFile falls back to root project', () => {
    expect(owningSbtProjectIdForFile('src/main/scala/App.scala', projects)).toBe('root')
  })

  it('computeSbtProjectScalaLineCounts sums by owner', () => {
    const files = [
      { relPath: 'animals/a.scala', source: 'a\nb\nc' },
      { relPath: 'animals/b.scala', source: 'x' },
      { relPath: 'src/main/scala/R.scala', source: 'one' },
    ]
    const counts = computeSbtProjectScalaLineCounts(files, [...projects])
    expect(counts.animals).toBe(4)
    expect(counts.root).toBe(1)
  })
})
