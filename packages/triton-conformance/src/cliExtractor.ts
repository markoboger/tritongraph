import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { ChangedFact, DiffKind, ResolvedTopology } from './types'
import { rawAstToChangedFact, type RawAst } from './rawAstFacts'

/**
 * Node-only fact extractor for the CLI. Uses Python's own stdlib `ast` via a subprocess — the target
 * repos are Python, so python3 is present, and `ast` is more accurate than reconstructing signatures
 * from a TS parser. The editor uses summarizePython (Vite/WASM) instead; both produce ChangedFact
 * via the shared rawAstFacts/astExtractor transforms.
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
    try:
        src = open(path, encoding='utf-8').read()
        tree = ast.parse(src)
    except Exception as exc:
        out.append({"error": "%s: %s" % (type(exc).__name__, exc)})
        continue
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

/** A file the extractor could not parse. Reported on stderr and kept in the run result. */
export interface SkippedFile {
  /** Repo-relative path. */
  path: string
  /** Python exception as `Type: message`, e.g. `SyntaxError: invalid syntax (broken.py, line 1)`. */
  reason: string
}

export interface ExtractedFacts {
  facts: ChangedFact[]
  skipped: SkippedFile[]
}

/**
 * Extract facts for the given files with a single python3 invocation (one interpreter start).
 * Files that fail to read or parse are skipped, never fatal — one broken file must not end the run.
 */
export function extractFacts(
  repoRoot: string,
  files: readonly { path: string; diff_kind: DiffKind }[],
  topology: ResolvedTopology,
  sourceRoots: readonly string[] = [],
): ExtractedFacts {
  if (files.length === 0) return { facts: [], skipped: [] }
  const json = execFileSync('python3', ['-c', AST_SCRIPT, ...files.map((f) => f.path)], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const raws = JSON.parse(json) as (RawAst | { error: string })[]

  const facts: ChangedFact[] = []
  const skipped: SkippedFile[] = []
  files.forEach((f, i) => {
    const raw = raws[i]
    if ('error' in raw) skipped.push({ path: f.path, reason: raw.error })
    else facts.push(rawAstToChangedFact(f.path, raw, f.diff_kind, topology, sourceRoots))
  })
  return { facts, skipped }
}

/** Facts only — the original entry point, unchanged for callers that ignore skipped files. */
export function extractChangedFacts(
  repoRoot: string,
  files: readonly { path: string; diff_kind: DiffKind }[],
  topology: ResolvedTopology,
  sourceRoots: readonly string[] = [],
): ChangedFact[] {
  return extractFacts(repoRoot, files, topology, sourceRoots).facts
}

/**
 * Read a control-file list (--control-files): one repo-relative path per line, blank lines and
 * `#` comments ignored, duplicates collapsed. The listed files are checked by the LLM although
 * nothing changed in them — that is how the false-positive rate gets a denominator.
 *
 * A path that does not exist aborts the run instead of being skipped: a silent drop here shrinks
 * that denominator without anyone noticing, which is exactly the failure class the protocol
 * already documents three times.
 *
 * Deliberately NO derivation of the set inside the tool ("everything outside the diff", "every
 * non-empty __init__.py"): what belongs in the control set is a protocol decision, and keeping it
 * out of the frozen measurement path makes the list itself an external, hashable artefact.
 */
export function readControlFileList(repoRoot: string, listPath: string): string[] {
  const paths = [
    ...new Set(
      readFileSync(listPath, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter((line) => line !== ''),
    ),
  ]
  const missing = paths.filter((path) => !existsSync(join(repoRoot, path)))
  if (missing.length > 0) {
    throw new Error(`--control-files ${listPath}: path(s) not found under ${repoRoot}: ${missing.join(', ')}`)
  }
  return paths
}

const SKIPPED_DIRS = new Set(['node_modules', '__pycache__'])

/**
 * All `*.py` under the source roots (or the whole repo when none are given), repo-relative and
 * sorted — the file list for `--rule-graph full`.
 *
 * ponytail: hidden directories, node_modules and __pycache__ are pruned; virtualenvs named without
 * a leading dot (`venv/`) are not. Pass --src-root if that ever matters.
 */
export function pythonFilesUnder(
  repoRoot: string,
  sourceRoots: readonly string[] = [],
): { path: string; diff_kind: DiffKind }[] {
  const roots = sourceRoots.length > 0 ? sourceRoots : ['.']
  const absolute = new Set<string>()
  for (const root of roots) collectPythonFiles(join(repoRoot, root), absolute)
  return [...absolute]
    .map((file) => relative(repoRoot, file).split(sep).join('/'))
    .sort()
    // Unchanged files carry no diff kind; 'modified' is inert here because only their imports are used.
    .map((path) => ({ path, diff_kind: 'modified' as DiffKind }))
}

function collectPythonFiles(dir: string, out: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectPythonFiles(full, out)
    else if (entry.name.endsWith('.py')) out.add(full)
  }
}
