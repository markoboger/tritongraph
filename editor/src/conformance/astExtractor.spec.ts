/**
 * Increment 4 check: the pure transform turns a parsed Python summary into changed_facts that match
 * the fixture, and the signature parser pulls structured params/return (annotations are the point —
 * that's where the framework leak hides).
 */
import { describe, it, expect } from 'vitest'
import {
  summaryToChangedFact,
  parsePythonSignature,
} from '../../../packages/triton-conformance/src/astExtractor'
import type { PythonFileSummary } from '../../../packages/triton-core/src/pythonCodeModel'
import { topology, changedFacts } from '../../../packages/triton-conformance/fixtures/miniRepo'

function fn(name: string, signature: string): PythonFileSummary['topLevel'][number] {
  return { name, kind: 'function', startRow: 0, endRow: 0, bases: [], decorators: [], members: [], signature }
}

describe('summaryToChangedFact', () => {
  it('reproduces the forbidden-edge fact (domain importing infra)', () => {
    const summary: PythonFileSummary = {
      modulePath: 'app.domain.order',
      filePath: 'app/domain/order.py',
      imports: [{ raw: 'from app.infra.db import session', modulePath: 'app.infra.db', names: ['session'] }],
      topLevel: [fn('create_order', 'def create_order(items: list) -> app.domain.order.Order')],
      lineCount: 1,
    }
    expect(summaryToChangedFact(summary, topology, 'modified')).toEqual(changedFacts[0])
  })

  it('reproduces the semantic-leak fact (flask.Request in a domain signature)', () => {
    const summary: PythonFileSummary = {
      modulePath: 'app.domain.pricing',
      filePath: 'app/domain/pricing.py',
      imports: [{ raw: 'import flask', modulePath: 'flask', names: [] }],
      topLevel: [fn('quote', 'def quote(req: flask.Request) -> app.domain.order.Money')],
      lineCount: 1,
    }
    const fact = summaryToChangedFact(summary, topology, 'modified')
    expect(fact).toEqual(changedFacts[1])
    // flask is external → unmapped component, only visible as a signature annotation.
    expect(fact.imports[0].target_component).toBeNull()
    expect(fact.signatures[0].params[0]).toEqual({ name: 'req', annotation: 'flask.Request' })
  })

  it('dedupes repeated import targets and drops relative-only (empty) imports', () => {
    const summary: PythonFileSummary = {
      modulePath: 'app.api.routes',
      filePath: 'app/api/routes.py',
      imports: [
        { raw: 'from app.domain.order import Order', modulePath: 'app.domain.order', names: ['Order'] },
        { raw: 'from app.domain.order import Money', modulePath: 'app.domain.order', names: ['Money'] },
        { raw: 'from . import thing', modulePath: '', names: ['thing'] },
      ],
      topLevel: [],
      lineCount: 1,
    }
    const fact = summaryToChangedFact(summary, topology, 'added')
    expect(fact.imports).toEqual([{ target: 'app.domain.order', target_component: 'domain' }])
  })

  it('emits method signatures so leaks inside class methods are visible', () => {
    const summary: PythonFileSummary = {
      modulePath: 'app.domain.cart',
      filePath: 'app/domain/cart.py',
      imports: [],
      topLevel: [
        {
          name: 'Cart',
          kind: 'class',
          startRow: 0,
          endRow: 5,
          bases: [],
          decorators: [],
          members: [{ name: 'add', kind: 'method', startRow: 1, endRow: 2, signature: 'def add(self, req: flask.Request)' }],
        },
      ],
      lineCount: 1,
    }
    const sig = summaryToChangedFact(summary, topology, 'modified').signatures[0]
    expect(sig).toEqual({
      symbol: 'Cart.add',
      kind: 'method',
      params: [{ name: 'self', annotation: null }, { name: 'req', annotation: 'flask.Request' }],
      returns: null,
    })
  })
})

describe('parsePythonSignature', () => {
  it('parses async, multiple params, and a return type', () => {
    expect(parsePythonSignature('async def f(x: int, y) -> str')).toEqual({
      params: [{ name: 'x', annotation: 'int' }, { name: 'y', annotation: null }],
      returns: 'str',
    })
  })

  it('returns null when there is no return annotation', () => {
    expect(parsePythonSignature('def g()')).toEqual({ params: [], returns: null })
  })

  it('keeps bracketed annotations intact and handles *args/**kwargs and defaults', () => {
    expect(parsePythonSignature('def h(items: Dict[str, int] = {}, *args, **kwargs: int)')).toEqual({
      params: [
        { name: 'items', annotation: 'Dict[str, int]' },
        { name: 'args', annotation: null },
        { name: 'kwargs', annotation: 'int' },
      ],
      returns: null,
    })
  })
})
