import { describe, expect, it } from 'vitest'
import { diffStatusByNode, type ChurnByFile } from './gitDiffOverlay'
import type { CodeModel } from '../../../packages/triton-core/src/languageModel'

/** Minimal model: root `app` with two child modules, each backed by one file, plus one artefact. */
function model(): CodeModel {
  return {
    id: 'app',
    name: 'app',
    language: 'python',
    relations: [],
    root: {
      id: 'app',
      name: 'app',
      kind: 'package',
      language: 'python',
      children: [
        {
          id: 'app.a',
          name: 'a',
          kind: 'module',
          language: 'python',
          source: { file: 'app/a.py', startLine: 1 },
          artefacts: [{ id: 'app.a.Widget', name: 'Widget', kind: 'class', language: 'python', source: { file: 'app/a.py', startLine: 1 } }],
          children: [],
        },
        {
          id: 'app.b',
          name: 'b',
          kind: 'module',
          language: 'python',
          source: { file: 'app/b.py', startLine: 1 },
          artefacts: [],
          children: [],
        },
      ],
      artefacts: [],
    },
  } as unknown as CodeModel
}

describe('diffStatusByNode', () => {
  it('classifies added / removed / modified / unchanged and aggregates to the parent', () => {
    const churn: ChurnByFile = {
      'app/a.py': { added: 5, removed: 0 }, // added only
      'app/b.py': { added: 2, removed: 3 }, // both -> modified
    }
    const status = diffStatusByNode(model(), churn)

    expect(status['app.a']).toBe('added')
    expect(status['app.a.Widget']).toBe('added') // leaf takes its own file
    expect(status['app.b']).toBe('modified')
    expect(status['app']).toBe('modified') // any-child-changed bubbles up (added + both)
  })

  it('marks a subtree with no churn as unchanged', () => {
    const status = diffStatusByNode(model(), {})
    expect(status['app']).toBe('unchanged')
    expect(status['app.a']).toBe('unchanged')
    expect(status['app.b']).toBe('unchanged')
  })

  it('classifies a removed-only file as removed', () => {
    const status = diffStatusByNode(model(), { 'app/b.py': { added: 0, removed: 4 } })
    expect(status['app.b']).toBe('removed')
    expect(status['app']).toBe('removed')
  })
})
