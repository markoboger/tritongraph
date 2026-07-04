import type { ChangedFact, DiffKind, FactSignature, ResolvedTopology } from './types'
import { componentOf } from './topology'
import { importsOf } from './astExtractor'
import {
  relativeFilePathToModulePath,
  resolveRelativeImport,
  type ParsedPythonImport,
} from '../../triton-core/src/pythonCodeModel'

/**
 * Pure RawAst → ChangedFact mapping (browser-safe; the python3 subprocess lives in cliExtractor).
 * Module-path derivation and relative-import resolution go through the same triton-core helpers as
 * the editor parser, and the import dedup/filter through astExtractor.importsOf, so CLI and editor
 * emit identical facts. Signatures stay structured from Python's ast (more accurate than the
 * editor's string parsing); the `Class.method` symbol naming must match astExtractor.signaturesOf.
 */
interface RawSig {
  name: string
  params: { name: string; annotation: string | null }[]
  returns: string | null
}
export interface RawAst {
  imports: { module: string; level: number }[]
  functions: RawSig[]
  classes: { name: string; methods: RawSig[] }[]
}

export function rawAstToChangedFact(
  path: string,
  raw: RawAst,
  diffKind: DiffKind,
  topology: ResolvedTopology,
  sourceRoots: readonly string[] = [],
): ChangedFact {
  const module = relativeFilePathToModulePath(path, sourceRoots)
  const isPackageInit = path.endsWith('/__init__.py') || path === '__init__.py'

  const parsedImports: ParsedPythonImport[] = raw.imports.map((imp) => ({
    raw: '',
    modulePath:
      imp.level > 0
        ? (resolveRelativeImport(module, isPackageInit, imp.level, imp.module) ?? '')
        : imp.module,
    names: [],
  }))

  const signatures: FactSignature[] = []
  for (const fn of raw.functions) {
    signatures.push({ symbol: fn.name, kind: 'function', params: fn.params, returns: fn.returns })
  }
  for (const cls of raw.classes) {
    for (const m of cls.methods) {
      signatures.push({ symbol: `${cls.name}.${m.name}`, kind: 'method', params: m.params, returns: m.returns })
    }
  }

  return {
    path,
    module,
    component: componentOf(topology, module),
    diff_kind: diffKind,
    imports: importsOf(parsedImports, topology),
    signatures,
  }
}
