import { execFileSync } from 'node:child_process'
import type { ChangedFact, DiffKind, FactSignature, ResolvedTopology } from './types'
import { componentOf } from './topology'
import { importsOf } from './astExtractor'
import {
  relativeFilePathToModulePath,
  resolveRelativeImport,
  type ParsedPythonImport,
} from '../../triton-core/src/pythonCodeModel'

/**
 * Node-only fact extractor for the CLI. Uses Python's own stdlib `ast` via a subprocess — the target
 * repos are Python, so python3 is present, and `ast` is more accurate than reconstructing signatures
 * from a TS parser. The editor uses summarizePython (Vite/WASM) instead; both produce ChangedFact.
 *
 * ponytail: requires `python3` on PATH and Python 3.9+ (ast.unparse). If that ever bites, swap in a
 * web-tree-sitter Node parse — the ChangedFact contract stays the same.
 */
const AST_SCRIPT = `
import ast, json, sys
def ann(a): return ast.unparse(a) if a is not None else None
def params(args):
    seq = args.posonlyargs + args.args
    if args.vararg: seq = seq + [args.vararg]
    seq = seq + args.kwonlyargs
    if args.kwarg: seq = seq + [args.kwarg]
    return [{"name": a.arg, "annotation": ann(a.annotation)} for a in seq]
out = []
for path in sys.argv[1:]:
    src = open(path, encoding='utf-8').read()
    tree = ast.parse(src)
    imports, functions, classes = [], [], []
    for node in tree.body:
        if isinstance(node, ast.Import):
            for n in node.names: imports.append({"module": n.name, "level": 0})
        elif isinstance(node, ast.ImportFrom):
            imports.append({"module": node.module or "", "level": node.level})
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append({"name": node.name, "params": params(node.args), "returns": ann(node.returns)})
        elif isinstance(node, ast.ClassDef):
            methods = [{"name": m.name, "params": params(m.args), "returns": ann(m.returns)}
                       for m in node.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
            classes.append({"name": node.name, "methods": methods})
    out.append({"imports": imports, "functions": functions, "classes": classes})
print(json.dumps(out))
`

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

/**
 * Pure RawAst → ChangedFact mapping (exported for tests; no subprocess). Module-path derivation and
 * relative-import resolution go through the same triton-core helpers as the editor parser, and the
 * import dedup/filter through astExtractor.importsOf, so CLI and editor emit identical facts.
 * Signatures stay structured from Python's ast (more accurate than the editor's string parsing);
 * the `Class.method` symbol naming must match astExtractor.signaturesOf.
 */
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

/** Extract facts for all changed files with a single python3 invocation (one interpreter start). */
export function extractChangedFacts(
  repoRoot: string,
  files: readonly { path: string; diff_kind: DiffKind }[],
  topology: ResolvedTopology,
  sourceRoots: readonly string[] = [],
): ChangedFact[] {
  if (files.length === 0) return []
  const json = execFileSync('python3', ['-c', AST_SCRIPT, ...files.map((f) => f.path)], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const raws = JSON.parse(json) as RawAst[]
  return files.map((f, i) => rawAstToChangedFact(f.path, raws[i], f.diff_kind, topology, sourceRoots))
}
