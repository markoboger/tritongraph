import { execFileSync } from 'node:child_process'
import type { ChangedFact, DiffKind, FactImport, FactSignature, ResolvedTopology } from './types'
import { componentOf } from './topology'
import { filePathToModulePath } from './modulePath'

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
src = open(sys.argv[1], encoding='utf-8').read()
tree = ast.parse(src)
def ann(a): return ast.unparse(a) if a is not None else None
def params(args):
    seq = args.posonlyargs + args.args
    if args.vararg: seq = seq + [args.vararg]
    seq = seq + args.kwonlyargs
    if args.kwarg: seq = seq + [args.kwarg]
    return [{"name": a.arg, "annotation": ann(a.annotation)} for a in seq]
imports, functions, classes = [], [], []
for node in tree.body:
    if isinstance(node, ast.Import):
        for n in node.names: imports.append({"module": n.name})
    elif isinstance(node, ast.ImportFrom):
        if node.level == 0 and node.module: imports.append({"module": node.module})
    elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        functions.append({"name": node.name, "params": params(node.args), "returns": ann(node.returns)})
    elif isinstance(node, ast.ClassDef):
        methods = [{"name": m.name, "params": params(m.args), "returns": ann(m.returns)}
                   for m in node.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
        classes.append({"name": node.name, "methods": methods})
print(json.dumps({"imports": imports, "functions": functions, "classes": classes}))
`

interface RawSig {
  name: string
  params: { name: string; annotation: string | null }[]
  returns: string | null
}
interface RawAst {
  imports: { module: string }[]
  functions: RawSig[]
  classes: { name: string; methods: RawSig[] }[]
}

export function extractChangedFact(
  repoRoot: string,
  path: string,
  diffKind: DiffKind,
  topology: ResolvedTopology,
  sourceRoots: readonly string[] = [],
): ChangedFact {
  const json = execFileSync('python3', ['-c', AST_SCRIPT, path], { cwd: repoRoot, encoding: 'utf8' })
  const raw = JSON.parse(json) as RawAst
  const module = filePathToModulePath(path, sourceRoots)

  const seen = new Set<string>()
  const imports: FactImport[] = []
  for (const imp of raw.imports) {
    if (seen.has(imp.module)) continue
    seen.add(imp.module)
    imports.push({ target: imp.module, target_component: componentOf(topology, imp.module) })
  }

  const signatures: FactSignature[] = []
  for (const fn of raw.functions) {
    signatures.push({ symbol: fn.name, kind: 'function', params: fn.params, returns: fn.returns })
  }
  for (const cls of raw.classes) {
    for (const m of cls.methods) {
      signatures.push({ symbol: `${cls.name}.${m.name}`, kind: 'method', params: m.params, returns: m.returns })
    }
  }

  return { path, module, component: componentOf(topology, module), diff_kind: diffKind, imports, signatures }
}
