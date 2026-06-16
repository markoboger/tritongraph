import { describe, expect, it } from 'vitest'

import {
  buildPythonCodeModelFromSummaries,
  type ParsedPythonArtefact,
  type ParsedPythonImport,
  type PythonFileSummary,
} from '../../../packages/triton-core/src/pythonCodeModel'

function cls(name: string, bases: string[] = []): ParsedPythonArtefact {
  return { name, kind: 'class', startRow: 0, endRow: 1, bases, decorators: [], members: [] }
}

function entry(
  modulePath: string,
  topLevel: ParsedPythonArtefact[],
  imports: ParsedPythonImport[] = [],
): { filePath: string; summary: PythonFileSummary } {
  const filePath = `${modulePath.replaceAll('.', '/')}.py`
  return { filePath, summary: { modulePath, filePath, imports, topLevel, lineCount: 0 } }
}

const extendsEdges = (relations: readonly { kind: string; from: string; to: string }[]) =>
  relations.filter((r) => r.kind === 'extends').map((r) => `${r.from} -> ${r.to}`)

describe('buildPythonCodeModelFromSummaries — import-aware inheritance', () => {
  it('resolves a base to the imported module when the name is ambiguous across modules', () => {
    const model = buildPythonCodeModelFromSummaries([
      entry('pkg.a', [cls('Handler')]),
      entry('pkg.b', [cls('Handler')]), // same simple name elsewhere → ambiguous without imports
      entry('pkg.user', [cls('MyHandler', ['Handler'])], [
        { raw: 'from pkg.a import Handler', modulePath: 'pkg.a', names: ['Handler'] },
      ]),
    ])
    expect(extendsEdges(model.relations)).toContain('pkg.user::class:MyHandler -> pkg.a::class:Handler')
  })

  it('resolves a dotted base (import pkg.a; class X(pkg.a.Handler))', () => {
    const model = buildPythonCodeModelFromSummaries([
      entry('pkg.a', [cls('Handler')]),
      entry('pkg.user', [cls('X', ['pkg.a.Handler'])], [
        { raw: 'import pkg.a', modulePath: 'pkg.a', names: [] },
      ]),
    ])
    expect(extendsEdges(model.relations)).toContain('pkg.user::class:X -> pkg.a::class:Handler')
  })

  it('falls back to the unique simple-name match when no import explains the base', () => {
    const model = buildPythonCodeModelFromSummaries([
      entry('pkg.base', [cls('Animal')]),
      entry('pkg.dog', [cls('Dog', ['Animal'])]),
    ])
    expect(extendsEdges(model.relations)).toContain('pkg.dog::class:Dog -> pkg.base::class:Animal')
  })

  it('still skips ambiguous bases with no import (avoids false edges)', () => {
    const model = buildPythonCodeModelFromSummaries([
      entry('pkg.a', [cls('Handler')]),
      entry('pkg.b', [cls('Handler')]),
      entry('pkg.user', [cls('MyHandler', ['Handler'])]), // no import → ambiguous → skipped
    ])
    expect(extendsEdges(model.relations)).toHaveLength(0)
  })
})
