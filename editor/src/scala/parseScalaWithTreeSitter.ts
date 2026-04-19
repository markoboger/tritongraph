import { Language, Parser, type Node as TSNode, type Tree } from 'web-tree-sitter'

import treeSitterRuntimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import treeSitterScalaWasmUrl from 'tree-sitter-scala/tree-sitter-scala.wasm?url'

/**
 * Browser-friendly tree-sitter Scala parser.
 *
 * Vite resolves both wasms via `?url` so they are emitted to dist/ with a hash and served from the
 * dev server. The same module also runs unmodified in any other ES-module environment that supports
 * `import.meta.url` (a future VS Code extension webview, for example).
 */

let initPromise: Promise<void> | null = null
let scalaLanguagePromise: Promise<Language> | null = null

async function fetchWasm(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load wasm at ${url}: ${res.status} ${res.statusText}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function ensureScalaLanguage(): Promise<Language> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile() {
        return treeSitterRuntimeWasmUrl
      },
    })
  }
  await initPromise
  if (!scalaLanguagePromise) {
    scalaLanguagePromise = (async () => {
      const bytes = await fetchWasm(treeSitterScalaWasmUrl)
      return Language.load(bytes)
    })()
  }
  return scalaLanguagePromise
}

/** Cached Parser per call-site reuse (parsers are cheap but `setLanguage` is reusable). */
let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  const lang = await ensureScalaLanguage()
  if (!cachedParser) {
    cachedParser = new Parser()
    cachedParser.setLanguage(lang)
  }
  return cachedParser
}

export interface ParsedScalaImport {
  /** Fully-qualified expression as written, e.g. `cats.effect.IO`, `scala.collection.{ Map, Set }`. */
  raw: string
  /** Leading dotted prefix, e.g. `cats.effect`. */
  prefix: string
  /** Imported names; empty when the import has no selector list (single-name import). */
  selectors: string[]
}

export interface ParsedScalaParent {
  /** Simple or dotted type name as written, with type parameters (`[T]`) and constructor args (`(…)`) stripped. */
  name: string
  /** `extends` for the primary parent, `with` for stacked traits. The first parent of a class/object is `extends`, every subsequent one is `with`. Traits use `extends` for the first base type and `with` for the rest, mirroring Scala source order. */
  kind: 'extends' | 'with'
}

export interface ParsedScalaDefinition {
  /** `class` | `trait` | `object` | `case class` | `enum` | `def` | `val` | `var` | `type` | `given` */
  kind: string
  name: string
  startRow: number
  endRow: number
  /**
   * Types appearing in the definition's `extends … with …` clause, in source order. Self-types
   * (`{ self: Foo => … }`) are intentionally NOT included — they constrain the type, they don't
   * extend it. Parameterised parents (`extends Consumer[Apple]`) are recorded as the bare name.
   * Empty for definitions without an `extends_clause` (vals, defs, top-level traits without a
   * base type, …).
   */
  parents: ParsedScalaParent[]
}

export interface ParsedScalaFile {
  /** `package` declaration, joined with dots; empty for files without one. */
  packageName: string
  imports: ParsedScalaImport[]
  /** Top-level (i.e. directly under the file or its package object) definitions. */
  topLevel: ParsedScalaDefinition[]
  /** Tree-sitter root node — exposed for richer downstream extractors (call graph, etc.). */
  rootNode: TSNode
  /** Owned tree; call `dispose()` to free wasm memory once you are done with `rootNode`. */
  dispose(): void
}

function joinDottedName(node: TSNode | null | undefined): string {
  if (!node) return ''
  return node.text.replace(/\s+/g, '')
}

function collectImports(rootNode: TSNode): ParsedScalaImport[] {
  const out: ParsedScalaImport[] = []
  const cursor = rootNode.walk()
  function visit(): void {
    const node = cursor.currentNode
    if (node.type === 'import_declaration') {
      /**
       * Newer tree-sitter-scala flattens `import a.b.{C, D}` into bare `identifier` / `.` /
       * `namespace_selectors` children rather than a single `import_expression`. Walking
       * `namedChild` therefore yields fragments that can't be reassembled into a meaningful
       * prefix individually. Instead we take the whole declaration's source text (minus the
       * leading `import` keyword) and let {@link splitImportExpr} parse the canonical form.
       *
       * Multiple imports on one line (`import a.b.C, d.e.F`) are supported by splitting on
       * top-level commas — commas inside `{ … }` selector lists are ignored.
       */
      const raw = node.text.trim()
      const stripped = raw.replace(/^import\s+/, '')
      for (const part of splitTopLevelCommas(stripped)) {
        const piece = part.replace(/\s+/g, ' ').trim()
        if (!piece) continue
        const { prefix, selectors } = splitImportExprText(piece)
        out.push({ raw: piece, prefix, selectors })
      }
      // No need to recurse into import children.
      return
    }
    if (cursor.gotoFirstChild()) {
      do {
        visit()
      } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }
  visit()
  cursor.delete()
  return out
}

/** Split `a, b.{c, d}, e` into `['a', 'b.{c, d}', 'e']` — commas inside `{ … }` stay grouped. */
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ''
  for (const ch of input) {
    if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim().length) out.push(buf)
  return out
}

/**
 * Parse a single canonical import expression text (`a.b.c`, `a.b._`, `a.b.{C, D => E}`) into
 * a `(prefix, selectors)` tuple.
 */
function splitImportExprText(text: string): { prefix: string; selectors: string[] } {
  // Match `<prefix>.{ A, B => C, _ }` selector list.
  const sel = text.match(/^([\w.]+)\s*\.\s*\{([^}]*)\}\s*$/)
  if (sel) {
    const prefix = sel[1] ?? ''
    const selectors = (sel[2] ?? '')
      .split(',')
      .map((s) => s.trim().split(/\s*=>\s*/)[0]?.trim() ?? '')
      .filter(Boolean)
    return { prefix, selectors }
  }
  // Match `<prefix>._` (wildcard import).
  const wild = text.match(/^([\w.]+)\s*\.\s*_$/)
  if (wild) {
    return { prefix: wild[1] ?? '', selectors: ['_'] }
  }
  // Match `<prefix>.<single>` — bag the trailing identifier as the selector for symmetry.
  const single = text.match(/^([\w.]+)\.(\w+)$/)
  if (single) {
    return { prefix: single[1] ?? '', selectors: [single[2] ?? ''] }
  }
  return { prefix: text.trim(), selectors: [] }
}

const TOP_LEVEL_KINDS: Record<string, string> = {
  class_definition: 'class',
  case_class_definition: 'case class',
  trait_definition: 'trait',
  object_definition: 'object',
  case_object_definition: 'case object',
  enum_definition: 'enum',
  function_definition: 'def',
  val_definition: 'val',
  var_definition: 'var',
  type_definition: 'type',
  given_definition: 'given',
}

function definitionName(node: TSNode): string {
  // tree-sitter-scala typically exposes the name via field `name` or as the first identifier child.
  const named = node.childForFieldName('name')
  if (named) return joinDottedName(named)
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && (c.type === 'identifier' || c.type === 'type_identifier')) return c.text
  }
  return ''
}

function collectTopLevel(packageNode: TSNode | null, rootNode: TSNode): ParsedScalaDefinition[] {
  const container = packageNode ?? rootNode
  const out: ParsedScalaDefinition[] = []
  for (let i = 0; i < container.namedChildCount; i++) {
    const c = container.namedChild(i)
    if (!c) continue
    const kind = TOP_LEVEL_KINDS[c.type]
    if (!kind) continue
    const name = definitionName(c)
    if (!name) continue
    out.push({
      kind,
      name,
      startRow: c.startPosition.row,
      endRow: c.endPosition.row,
      parents: extractParents(c),
    })
  }
  return out
}

/**
 * Pull `extends X with Y with Z` from a class/trait/object/enum/case-class definition.
 *
 * The grammar exposes the `extends` portion as an `extends_clause` child stored under the
 * `extend` field of `_class_definition`. We try that first; when the field is unavailable
 * (some grammar / wasm builds don't surface inline-rule fields reliably), we fall back to
 * scanning the definition's *header* (the source text from the definition start up to the
 * `body` field's start, or the first `{` if the body field isn't surfaced). Critically the
 * fallback never reaches into the body, so nested `extends` clauses on inner definitions
 * (e.g. `case class Foo extends Bar` inside a companion `object`) cannot bleed into the
 * outer definition's parent list.
 *
 * The regex matches the `extends` keyword and every subsequent `with` keyword followed by a
 * capital-letter (optionally dotted) identifier; type-arguments `[T]` and constructor
 * arguments `(…)` are naturally truncated since `[\w.]*` stops at `[`/`(`.
 *
 * Self-type clauses (`{ self: Foo => … }`) live inside `template_body`, not in either the
 * `extends_clause` or the header, so they don't contaminate this output.
 */
function extractParents(defNode: TSNode): ParsedScalaParent[] {
  const extendsClause = defNode.childForFieldName('extend')
  let text = extendsClause?.text ?? ''
  if (!text) {
    const headerText = headerTextOf(defNode)
    const extIdx = matchKeywordIndex(headerText, 'extends')
    if (extIdx === -1) return []
    text = headerText.slice(extIdx)
  }
  const out: ParsedScalaParent[] = []
  const re = /(?:^|\s)(extends|with)\s+([A-Z][\w.]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const keyword = m[1] === 'extends' ? 'extends' : 'with'
    const name = m[2]
    if (!name) continue
    out.push({ kind: keyword, name })
  }
  return out
}

/**
 * Source text of `defNode` from its start up to (but not including) its body opener — i.e.
 * exactly the part of the definition that may contain an `extends … with …` clause. Falls
 * back to the first `{` in the source text if the grammar doesn't expose a `body` field,
 * and to the full definition text if there is no body at all (an abstract class with no
 * braces, for example).
 */
function headerTextOf(defNode: TSNode): string {
  const body = defNode.childForFieldName('body')
  const full = defNode.text
  if (body && Number.isFinite(body.startIndex) && Number.isFinite(defNode.startIndex)) {
    const len = body.startIndex - defNode.startIndex
    if (len > 0 && len <= full.length) return full.slice(0, len)
  }
  const braceIdx = full.indexOf('{')
  return braceIdx >= 0 ? full.slice(0, braceIdx) : full
}

/** Find the index of a whole-word keyword (`\bextends\b` semantics) in `text`, or -1. */
function matchKeywordIndex(text: string, keyword: string): number {
  const re = new RegExp(`(?:^|\\s)${keyword}(?=\\s)`)
  const m = re.exec(text)
  if (!m) return -1
  return m.index + (m[0].length - keyword.length)
}

function findPackageDeclaration(rootNode: TSNode): { packageName: string; bodyNode: TSNode | null } {
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const c = rootNode.namedChild(i)
    if (!c) continue
    if (c.type === 'package_clause' || c.type === 'package_declaration') {
      const id = c.childForFieldName('name') ?? c.namedChild(0)
      const packageName = joinDottedName(id)
      // Some grammar versions nest the file body inside `package_declaration`.
      const body = c.childForFieldName('body') ?? null
      return { packageName, bodyNode: body }
    }
    if (c.type === 'package_object') {
      const id = c.childForFieldName('name') ?? c.namedChild(0)
      return { packageName: joinDottedName(id), bodyNode: c.childForFieldName('body') ?? null }
    }
  }
  return { packageName: '', bodyNode: null }
}

export async function parseScala(source: string): Promise<ParsedScalaFile> {
  const parser = await getParser()
  const tree: Tree = parser.parse(source) as Tree
  const rootNode = tree.rootNode
  const { packageName, bodyNode } = findPackageDeclaration(rootNode)
  const imports = collectImports(rootNode)
  const topLevel = collectTopLevel(bodyNode, rootNode)
  return {
    packageName,
    imports,
    topLevel,
    rootNode,
    dispose: () => tree.delete(),
  }
}

/** Convenience: parse, extract a slim summary, and immediately release the tree. */
export interface ScalaFileSummary {
  packageName: string
  imports: ParsedScalaImport[]
  topLevel: ParsedScalaDefinition[]
}

export async function summarizeScala(source: string): Promise<ScalaFileSummary> {
  const parsed = await parseScala(source)
  const summary: ScalaFileSummary = {
    packageName: parsed.packageName,
    imports: parsed.imports,
    topLevel: parsed.topLevel,
  }
  parsed.dispose()
  return summary
}
