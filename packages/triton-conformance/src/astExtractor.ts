import type {
  PythonFileSummary,
  ParsedPythonArtefact,
  ParsedPythonImport,
} from '../../triton-core/src/pythonCodeModel'
import type { ChangedFact, DiffKind, FactImport, FactParam, FactSignature, ResolvedTopology } from './types'
import { componentOf } from './topology'

/**
 * AST-extractor [1] — the pure transform half. Maps a parsed Python file summary to `changed_facts`
 * (spec §3.2): imports + signatures with type annotations, resolved to components.
 *
 * The source→summary parse is environment-specific and injected by the caller: the editor uses
 * `summarizePython` (Vite/WASM), the CLI a Node tree-sitter parse. This file imports neither, so it
 * stays Node- and browser-safe. Only signatures + imports go in (C-7: no raw code).
 */
export function summaryToChangedFact(
  summary: PythonFileSummary,
  topology: ResolvedTopology,
  diffKind: DiffKind,
): ChangedFact {
  return {
    path: summary.filePath,
    module: summary.modulePath,
    component: componentOf(topology, summary.modulePath),
    diff_kind: diffKind,
    imports: importsOf(summary.imports, topology),
    signatures: signaturesOf(summary.topLevel),
  }
}

/** Dedup + component-resolve imports. Shared with the CLI extractor so both emit identical facts. */
export function importsOf(
  imports: readonly ParsedPythonImport[],
  topology: ResolvedTopology,
): FactImport[] {
  const seen = new Set<string>()
  const out: FactImport[] = []
  for (const imp of imports) {
    if (imp.modulePath === '' || seen.has(imp.modulePath)) continue
    seen.add(imp.modulePath)
    out.push({ target: imp.modulePath, target_component: componentOf(topology, imp.modulePath) })
  }
  return out
}

function signaturesOf(topLevel: readonly ParsedPythonArtefact[]): FactSignature[] {
  const out: FactSignature[] = []
  for (const artefact of topLevel) {
    if (artefact.kind === 'function' && artefact.signature) {
      out.push({ symbol: artefact.name, kind: 'function', ...parsePythonSignature(artefact.signature) })
    }
    // Class methods can leak framework types via their parameters too (e.g. flask.Request).
    for (const member of artefact.members) {
      out.push({
        symbol: `${artefact.name}.${member.name}`,
        kind: 'method',
        ...parsePythonSignature(member.signature),
      })
    }
  }
  return out
}

/**
 * Parse a `def name(params) -> ret` signature string into structured params + return. Annotations
 * are the point — `req: flask.Request` is a semantic leak invisible in the import list (§3.2).
 */
export function parsePythonSignature(signature: string): { params: FactParam[]; returns: string | null } {
  const open = signature.indexOf('(')
  if (open === -1) return { params: [], returns: null }
  const close = matchingParen(signature, open)
  const paramsStr = signature.slice(open + 1, close)
  const after = signature.slice(close + 1)
  const arrow = after.indexOf('->')
  const returns = arrow === -1 ? null : after.slice(arrow + 2).replace(/:\s*$/, '').trim() || null
  return { params: splitTopLevel(paramsStr).map(parseParam).filter((p): p is FactParam => p !== null), returns }
}

/** Index of the ')' matching the '(' at `open`, respecting nested brackets. */
function matchingParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return text.length
}

/** Split on top-level commas, ignoring commas inside (), [], {} (e.g. Dict[str, int]). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

function parseParam(raw: string): FactParam | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '*' || trimmed === '/') return null
  const colon = trimmed.indexOf(':')
  if (colon !== -1) {
    const name = stripStars(trimmed.slice(0, colon).trim())
    const annotation = trimmed.slice(colon + 1).split('=')[0].trim()
    return { name, annotation: annotation || null }
  }
  const name = stripStars(trimmed.split('=')[0].trim())
  return { name, annotation: null }
}

function stripStars(name: string): string {
  return name.replace(/^\*+/, '')
}
