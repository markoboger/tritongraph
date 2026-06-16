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
      'x-triton-language': 'typescript',
      'x-triton-declaration': 'export class App',
      'x-triton-constructor-signatures': [{ signature: 'constructor(widget: Widget)', startRow: 24 }],
    })
    expect(doc.perspectives?.[0]).toMatchObject({
      name: 'package imports',
      orientation: 'leftToRight',
      relations: [{ from: 'editor/graph', to: 'editor/components', label: 'imports' }],
    })
  })

  it('appends lines-of-code to package subtitles when fileLineCounts is supplied', () => {
    const baseModel: CodeModel = {
      id: 'loc-demo',
      name: 'loc-demo',
      language: 'python',
      root: {
        id: 'loc-demo',
        name: 'loc-demo',
        kind: 'workspace',
        language: 'python',
        artefacts: [],
        children: [
          {
            id: 'api',
            name: 'api',
            kind: 'package',
            language: 'python',
            source: { file: 'api/__init__.py', startRow: 0 },
            artefacts: [{
              id: 'api::class:Router',
              name: 'Router',
              kind: 'class',
              language: 'python',
              declaration: 'class Router',
              source: { file: 'api/router.py', startRow: 0, endRow: 40 },
              members: [],
            }],
            children: [],
          },
          {
            id: 'util',
            name: 'util',
            kind: 'package',
            language: 'python',
            source: { file: 'util/__init__.py', startRow: 0 },
            artefacts: [{
              id: 'util::function:slugify',
              name: 'slugify',
              kind: 'function',
              language: 'python',
              declaration: 'def slugify(value)',
              source: { file: 'util/text.py', startRow: 0, endRow: 9 },
              members: [],
            }],
            children: [],
          },
        ],
      },
      relations: [],
    }

    const withCounts = codeModelToIlographDocument(
      { ...baseModel, fileLineCounts: { 'api/__init__.py': 12, 'api/router.py': 88, 'util/text.py': 30 } },
      { projectionMode: 'package-graph' },
    )
    const apiPkg = withCounts.resources?.find((r) => (r as { id?: string }).id === 'api')
    // 12 (__init__.py) + 88 (router.py) summed across the package subtree.
    expect((apiPkg as { subtitle?: string }).subtitle).toMatch(/, 100 loc$/)

    // Without counts, no LOC suffix is added.
    const noCounts = codeModelToIlographDocument(baseModel, { projectionMode: 'package-graph' })
    const apiNoLoc = noCounts.resources?.find((r) => (r as { id?: string }).id === 'api')
    expect((apiNoLoc as { subtitle?: string }).subtitle).not.toMatch(/loc/)
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

  it('carries the real leaf language into flow node data (drives language-specific presentation)', () => {
    const flow = ilographDocumentToFlow({
      resources: [{
        id: 'app::function:get_analysis',
        name: 'get_analysis',
        subtitle: 'function',
        'x-triton-node-type': 'artefact',
        'x-triton-language': 'python',
      }],
    })

    // The real language wins over the decorative hash so a Python def stops rendering Scala chrome.
    expect(flow.nodes[0]?.data).toMatchObject({ language: 'python' })
    // ...and the Scala-specific synthetic sbt drill note is suppressed for non-Scala leaves.
    expect((flow.nodes[0]?.data as { drillNote?: string }).drillNote).toBeUndefined()
  })
})
