import { describe, expect, it } from 'vitest'
import { ilographDocumentToFlow } from './ilographToFlow'
import type { IlographDocument } from '../ilograph/types'

describe('ilographDocumentToFlow', () => {
  it('prefers the explicitly requested perspective when present', () => {
    const doc: IlographDocument = {
      resources: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      perspectives: [
        {
          name: 'dependencies',
          relations: [{ from: 'a', to: 'b', label: 'depends on' }],
        },
        {
          id: 'runtime-view',
          name: 'Runtime View',
          relations: [{ from: 'c', to: 'a', label: 'calls' }],
        },
      ],
    }

    const flow = ilographDocumentToFlow(doc, { preferredPerspectiveName: 'runtime-view' })

    expect(flow.perspectiveName).toBe('Runtime View')
    expect(flow.edges).toHaveLength(1)
    expect(flow.edges[0]).toMatchObject({
      source: 'c',
      target: 'a',
      label: 'calls',
    })
  })
})
