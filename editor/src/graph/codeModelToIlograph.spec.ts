import { describe, expect, it } from 'vitest'
import { ilographDocumentToFlow } from './ilographToFlow'
import { codeModelToIlographDocument } from './codeModelToIlograph'
import type { CodeModel } from '../../../packages/triton-core/src/languageModel.ts'

describe('codeModelToIlographDocument', () => {
  it('projects a scoped TypeScript module as a package-scope graph with package import edges', () => {
    const model: CodeModel = {
      id: 'demo',
      name: 'demo',
      language: 'typescript',
      root: {
        id: '<root>',
        name: 'demo',
        kind: 'workspace',
        language: 'typescript',
        artefacts: [],
        children: [
          {
            id: 'editor',
            name: 'editor',
            kind: 'module',
            language: 'typescript',
            artefacts: [{
              id: 'editor::class:App',
              name: 'App',
              kind: 'class',
              language: 'typescript',
              declaration: 'export class App',
              source: { file: 'editor/App.ts', startRow: 1 },
              members: [{
                id: 'editor::class:App::constructor:24:constructor',
                name: 'constructor',
                kind: 'constructor',
                language: 'typescript',
                declaration: 'constructor(widget: Widget)',
                source: { file: 'editor/App.ts', startRow: 24 },
              }],
            }],
            children: [
              {
                id: 'editor/features',
                name: 'features',
                kind: 'folder',
                language: 'typescript',
                artefacts: [],
                children: [
                  {
                    id: 'editor/features/search',
                    name: 'search',
                    kind: 'folder',
                    language: 'typescript',
                    artefacts: [{
                      id: 'editor/features/search::class:SearchBox',
                      name: 'SearchBox',
                      kind: 'class',
                      language: 'typescript',
                      declaration: 'export class SearchBox',
                      source: { file: 'editor/features/search/SearchBox.ts', startRow: 6 },
                      members: [],
                    }],
                    children: [],
                  },
                ],
              },
              {
                id: 'editor/components',
                name: 'components',
                kind: 'folder',
                language: 'typescript',
                artefacts: [{
                  id: 'editor/components::class:Widget',
                  name: 'Widget',
                  kind: 'class',
                  language: 'typescript',
                  declaration: 'export class Widget',
                  source: { file: 'editor/components/Widget.ts', startRow: 0 },
                  members: [],
                }],
                children: [],
              },
              {
                id: 'editor/graph',
                name: 'graph',
                kind: 'folder',
                language: 'typescript',
                artefacts: [{
                  id: 'editor/graph::function:layout',
                  name: 'layout',
                  kind: 'function',
                  language: 'typescript',
                  declaration: 'export function layout(): void',
                  source: { file: 'editor/graph/layout.ts', startRow: 3 },
                  members: [],
                }],
                children: [],
              },
            ],
          },
        ],
      },
      relations: [
        {
          id: 'container:imports:editor/graph->editor/components:0',
          from: 'editor/graph',
          to: 'editor/components',
          kind: 'imports',
          scope: 'container',
        },
      ],
    }

    const doc = codeModelToIlographDocument(model, {
      projectionMode: 'nested-resources',
      scopeContainerId: 'editor',
    })

    expect(doc.resources).toHaveLength(1)
    expect(doc.resources?.[0]).toMatchObject({
      id: 'editor',
      name: 'editor',
      'x-triton-package-scope': true,
      'x-triton-package-language': 'typescript',
    })
    const childIds = doc.resources?.[0]?.children
      ?.map((child) => (child as { id?: string }).id)
      .sort()
    expect(childIds).toEqual([
      'editor/features/search',
      'editor::class:App',
      'editor/components',
      'editor/graph',
    ].sort())
    const search = doc.resources?.[0]?.children?.find((child) => (child as { id?: string }).id === 'editor/features/search')
    expect(search).toMatchObject({
      id: 'editor/features/search',
      name: 'features/search',
      'x-triton-node-type': 'package',
    })
    const directArtefact = doc.resources?.[0]?.children?.find((child) => (
      child as { id?: string }
    ).id === 'editor::class:App')
    expect(directArtefact).toMatchObject({
      id: 'editor::class:App',
      'x-triton-node-type': 'artefact',
      'x-triton-declaration': 'export class App',
      'x-triton-constructor-signatures': [{ signature: 'constructor(widget: Widget)', startRow: 24 }],
    })
    expect(doc.perspectives?.[0]).toMatchObject({
      name: 'package imports',
      orientation: 'leftToRight',
      relations: [{ from: 'editor/graph', to: 'editor/components', label: 'imports' }],
    })
  })

  it('normalizes top-level constructor signatures for artefact leaves', () => {
    const flow = ilographDocumentToFlow({
      resources: [{
        id: 'editor::class:App',
        name: 'App',
        'x-triton-node-type': 'artefact',
        'x-triton-constructor-signatures': [{ signature: 'constructor(widget: Widget)', startRow: 24 }],
      }],
    })

    expect(flow.nodes[0]?.data).toMatchObject({
      constructorSignatures: [{ signature: 'constructor(widget: Widget)', startRow: 24 }],
    })
  })
})
