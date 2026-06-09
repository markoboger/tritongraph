import { describe, expect, it } from 'vitest'

import { codeModelToFullExportDocument } from '../../../packages/triton-core/src/codeModelToIlograph'
import type {
  CodeArtefact,
  CodeContainer,
  CodeModel,
  CodeRelation,
} from '../../../packages/triton-core/src/languageModel'

const art = (id: string, name: string): CodeArtefact => ({
  id,
  name,
  kind: 'class',
  language: 'python',
  declaration: `class ${name}`,
  source: { file: 'f.py', startRow: 12 },
  members: [
    { id: `${id}#m`, name: 'run', kind: 'method', language: 'python', declaration: 'def run(self) -> None', source: { file: 'f.py', startRow: 14 } },
  ],
})
const mod = (id: string, name: string, artefacts: CodeArtefact[] = []): CodeContainer => ({
  id,
  name,
  kind: 'module',
  language: 'python',
  children: [],
  artefacts,
})
const pkg = (id: string, name: string, children: CodeContainer[] = []): CodeContainer => ({
  id,
  name,
  kind: 'package',
  language: 'python',
  children,
  artefacts: [],
})
const imp = (from: string, to: string): CodeRelation => ({
  id: `r:${from}->${to}`,
  from,
  to,
  kind: 'imports',
  scope: 'container',
})
const model = (children: CodeContainer[], relations: CodeRelation[] = []): CodeModel => ({
  id: 'm',
  name: 'M',
  language: 'python',
  root: { id: 'm', name: 'M', kind: 'workspace', language: 'python', children, artefacts: [] },
  relations,
})

type Res = Record<string, unknown> & { id: string; children?: Res[] }
const exportDoc = (
  m: CodeModel,
  opts: { scopeContainerId?: string; detail?: 'slim' | 'full' } = {},
) =>
  codeModelToFullExportDocument(m, opts) as unknown as {
    resources: Res[]
    perspectives: Array<{ relations: Array<{ from: string; to: string; label: string }> }>
  }

function allIds(resources: Res[], out: string[] = []): string[] {
  for (const r of resources) {
    out.push(r.id)
    if (r.children) allIds(r.children, out)
  }
  return out
}

describe('codeModelToFullExportDocument', () => {
  const build = () => {
    const core = pkg('app.core', 'core', [mod('app.core.db', 'db', [art('app.core.db::class:Conn', 'Conn')])])
    const vert = pkg('app.vertiport', 'vertiport', [mod('app.vertiport.svc', 'svc', [art('app.vertiport.svc::class:Svc', 'Svc')])])
    const app = pkg('app', 'app', [core, vert])
    const rels = [
      imp('app.core.db', 'app.vertiport.svc'),
      imp('app.vertiport.svc', 'app.core.db'),
    ]
    return model([app], rels)
  }

  it('nests every package, module and class for a whole-project export', () => {
    const doc = exportDoc(build())
    const ids = allIds(doc.resources)
    expect(ids).toContain('app')
    expect(ids).toContain('app.core')
    expect(ids).toContain('app.core.db')
    expect(ids).toContain('app.vertiport.svc')
  })

  it('includes import edges at container level (deduped)', () => {
    const edges = exportDoc(build()).perspectives[0]!.relations
    expect(edges).toContainEqual({ from: 'app.core.db', to: 'app.vertiport.svc', label: 'imports' })
    expect(edges).toContainEqual({ from: 'app.vertiport.svc', to: 'app.core.db', label: 'imports' })
  })

  it('scopes to a package subtree and keeps only in-scope import edges (dot-separated ids)', () => {
    const doc = exportDoc(build(), { scopeContainerId: 'app.core' })
    expect(doc.resources.map((r) => r.id)).toEqual(['app.core'])
    expect(allIds(doc.resources)).toContain('app.core.db')
    expect(allIds(doc.resources)).not.toContain('app.vertiport.svc')
    // Both edges cross out of app.core, so none survive the scope filter.
    expect(doc.perspectives[0]!.relations).toEqual([])
  })

  it('keeps an in-scope edge when both endpoints are inside the scope', () => {
    const core = pkg('app.core', 'core', [
      mod('app.core.db', 'db', [art('app.core.db::class:Conn', 'Conn')]),
      mod('app.core.cache', 'cache', [art('app.core.cache::class:Cache', 'Cache')]),
    ])
    const m = model([pkg('app', 'app', [core])], [imp('app.core.db', 'app.core.cache')])
    const edges = exportDoc(m, { scopeContainerId: 'app.core' }).perspectives[0]!.relations
    expect(edges).toEqual([{ from: 'app.core.db', to: 'app.core.cache', label: 'imports' }])
  })

  it('slim (default) drops declarations/signatures/source and trims inner artefacts', () => {
    const dbResource = allFlat(exportDoc(build()).resources).find((r) => r.id === 'app.core.db')!
    expect(dbResource['x-triton-declaration']).toBeUndefined()
    expect(dbResource['x-triton-method-signatures']).toBeUndefined()
    expect(dbResource['x-triton-source-file']).toBeUndefined()
    const inner = dbResource['x-triton-inner-artefacts'] as Array<Record<string, unknown>>
    expect(inner[0]).toEqual({ id: 'app.core.db::class:Conn', name: 'Conn', subtitle: 'class' })
  })

  it('full detail keeps declarations and method signatures', () => {
    const dbResource = allFlat(exportDoc(build(), { detail: 'full' }).resources).find((r) => r.id === 'app.core.db')!
    const inner = dbResource['x-triton-inner-artefacts'] as Array<Record<string, unknown>>
    expect(inner[0]!['declaration']).toBe('class Conn')
    expect(inner[0]!['methodSignatures']).toBeTruthy()
  })
})

function allFlat(resources: Res[], out: Res[] = []): Res[] {
  for (const r of resources) {
    out.push(r)
    if (r.children) allFlat(r.children, out)
  }
  return out
}
