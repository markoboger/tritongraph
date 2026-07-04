/**
 * The pure RawAst → ChangedFact half of the CLI extractor (the python3 subprocess is not run here).
 * The point: CLI facts must match editor facts — same module-path mapping, same relative-import
 * resolution, same import dedup — so the eval join never sees tool-dependent facts.
 */
import { describe, it, expect } from 'vitest'
import {
  rawAstToChangedFact,
  type RawAst,
} from '../../../packages/triton-conformance/src/cliExtractor'
import { topology } from '../../../packages/triton-conformance/fixtures/miniRepo'

const emptyAst: RawAst = { imports: [], functions: [], classes: [] }

describe('rawAstToChangedFact', () => {
  it('derives module and component from the file path', () => {
    const fact = rawAstToChangedFact('app/domain/order.py', emptyAst, 'modified', topology)
    expect(fact.module).toBe('app.domain.order')
    expect(fact.component).toBe('domain')
  })

  it('resolves relative imports like the editor parser (plain module)', () => {
    // `from ..db import x` in app/domain/order.py: two dots resolve to `app`, target app.db.
    const raw: RawAst = { ...emptyAst, imports: [{ module: 'db', level: 2 }] }
    const fact = rawAstToChangedFact('app/domain/order.py', raw, 'modified', topology)
    expect(fact.imports).toEqual([{ target: 'app.db', target_component: null }])
  })

  it('resolves a one-dot relative import in a package __init__.py against the package itself', () => {
    const raw: RawAst = { ...emptyAst, imports: [{ module: 'order', level: 1 }] }
    const fact = rawAstToChangedFact('app/domain/__init__.py', raw, 'modified', topology)
    expect(fact.module).toBe('app.domain')
    expect(fact.imports).toEqual([{ target: 'app.domain.order', target_component: 'domain' }])
  })

  it('dedupes repeated imports and drops unresolvable relative ones', () => {
    const raw: RawAst = {
      ...emptyAst,
      imports: [
        { module: 'app.infra.db', level: 0 },
        { module: 'app.infra.db', level: 0 },
        // `from . import x` in a top-level module points above the root → dropped.
        { module: '', level: 1 },
      ],
    }
    const fact = rawAstToChangedFact('main.py', raw, 'modified', topology)
    expect(fact.imports).toEqual([{ target: 'app.infra.db', target_component: 'infra' }])
  })

  it('emits Class.method symbols matching astExtractor.signaturesOf', () => {
    const raw: RawAst = {
      ...emptyAst,
      functions: [{ name: 'quote', params: [{ name: 'req', annotation: 'flask.Request' }], returns: null }],
      classes: [
        {
          name: 'Order',
          methods: [{ name: 'total', params: [{ name: 'self', annotation: null }], returns: 'int' }],
        },
      ],
    }
    const fact = rawAstToChangedFact('app/domain/order.py', raw, 'added', topology)
    expect(fact.signatures.map((s) => s.symbol)).toEqual(['quote', 'Order.total'])
    expect(fact.signatures[1]).toEqual({
      symbol: 'Order.total',
      kind: 'method',
      params: [{ name: 'self', annotation: null }],
      returns: 'int',
    })
  })
})
