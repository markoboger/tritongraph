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
  /**
   * Original type-argument text as written in the source — including the enclosing brackets
   * (`"[Fruit.Apple]"`, `"[List[Option[Bear]]]"`) — or `undefined` when the parent isn't
   * parameterised. Kept separate from `name` so downstream resolvers can still match on the
   * bare simple name while {@link ParsedScalaDefinition#declaration} (and any other display
   * that wants the full signature) can reconstruct `Eater[Fruit.Apple]` verbatim.
   */
  typeArgs?: string
}

/**
 * A single `def` member signature plus the 0-indexed source row of its declaration. The row
 * is the tree-sitter `startPosition.row` for the method node — not for the `def` keyword
 * specifically, but for whichever token starts the declaration (annotation, modifier, or
 * `def`). That's the line editor URL schemes want anyway: "put the cursor at the top of
 * the definition", which is where the user expects to land.
 */
export interface ParsedScalaMethodSignature {
  signature: string
  startRow: number
  /** 0-indexed last row of the method node (inclusive with {@link startRow}). */
  endRow: number
}

export interface ParsedScalaDefinition {
  /** `class` | `trait` | `object` | `case class` | `enum` | `def` | `val` | `var` | `type` | `given` */
  kind: string
  name: string
  startRow: number
  endRow: number
  /**
   * Leading modifier keywords in source order (`sealed`, `abstract`, `final`, `private`,
   * `protected`, `private[app]`, …). Empty when no modifiers appear. Captured so a display
   * declaration can read `sealed trait Animal extends Named` instead of silently dropping
   * the `sealed` part — the `kind` keyword alone is not enough because tree-sitter only
   * surfaces it via the definition node's type (`trait_definition`) and leaves modifiers as
   * plain token prefixes.
   */
  modifiers: string[]
  /**
   * Types appearing in the definition's `extends … with …` clause, in source order. Self-types
   * (`{ self: Foo => … }`) are intentionally NOT included — they constrain the type, they don't
   * extend it. Parameterised parents (`extends Consumer[Apple]`) are recorded as the bare name.
   * Empty for definitions without an `extends_clause` (vals, defs, top-level traits without a
   * base type, …).
   */
  parents: ParsedScalaParent[]
  /**
   * Simple (capital-case) type names referenced from the primary constructor parameter list(s)
   * of a class / case class. Collected from the *entire* parameter section — type arguments
   * included — so a parameter `xs: List[Option[Bear]]` contributes `List`, `Option`, `Bear`.
   *
   * Why capital-case only: Scala type identifiers conventionally start with an upper-case letter,
   * so this filters out the parameter *names* (`xs`, `count`, …) while keeping type references.
   *
   * Why keep wrappers (`List`, `Option`, …): dropping them is the consumer's job. Callers resolve
   * each name against the known-artefact set; stdlib wrappers never resolve to a local artefact
   * and are implicitly discarded, while the inner parameter (`Bear` above) binds correctly. This
   * keeps the parser oblivious to the "stdlib" list, which differs per project (cats / ZIO / …).
   *
   * Empty for kinds without a primary constructor (`trait` with no parameter clause, `object`,
   * `def`, `val`, `var`, `type`, `given`). De-duplicated, source-ordered.
   */
  paramTypeRefs: Array<{ name: string; wrapper?: string }>
  /**
   * Capital-case type names that appear as constructor-style calls in this definition's body,
   * e.g. `new Bear(...)`, `Bear(...)`, `diet.Profile(...)` (stored as written, sans args).
   *
   * This is intentionally source-derived and conservative: we only keep capital-case callee
   * names, then downstream graph resolution filters to project-local artefacts. Stdlib and
   * third-party constructors (`String(...)`, `Future(...)`, …) therefore fall away naturally.
   */
  createdTypeRefs: string[]
  /**
   * Source text of the primary constructor parameter clauses for a `class` / `case class`,
   * preserving the author's parentheses — e.g. `"(variety: String, ripeness: Ripeness.Value)"`,
   * `"(a: A)(implicit b: B)"`. Empty string for traits / objects / defs / vals and for classes
   * without a parameter clause.
   *
   * Multi-line sources are collapsed to a single line (runs of whitespace → space) so the
   * Shiki-rendered "Arguments" panel stays one tidy line regardless of the original wrap.
   * The parent `extends` clause is stripped before scanning; pre-parameter type-parameter
   * brackets (`class Foo[T <: Bar]`) are intentionally dropped — they are type parameters,
   * not runtime arguments, and live with the declaration header elsewhere.
   */
  constructorParams: string
  /**
   * One-line signatures of `def` members declared **directly** inside this definition's body
   * (no descent into nested classes / companion objects). Each entry carries the full Scala
   * signature up to but excluding the body — e.g. `"def foo(x: Int): String"`,
   * `"def bar[T](xs: List[T]): T"`, `"override def toString: String"` — together with the
   * 0-indexed source row of the `def` keyword. The row lets the focused Methods panel wire
   * each signature as a click-to-open-at-line action; rows are 0-indexed here (tree-sitter
   * convention) and are bumped to 1-indexed when composing editor URLs.
   *
   * Abstract defs (no `=` body) are kept verbatim.
   *
   * Scope:
   *   - `def` only for now (the focused Methods panel lists *methods*). `val` / `var` / `type`
   *     members could be added later behind a kind filter if the UI needs them.
   *   - Multi-line source signatures are collapsed to a single line (runs of whitespace → space)
   *     so the Shiki-rendered list stays consistent regardless of how the author wrapped args.
   *
   * Source-ordered, not de-duplicated (overloads are a legitimate thing — two `def apply(...)`
   * entries with different signatures should both show).
   */
  methodSignatures: ParsedScalaMethodSignature[]
  /**
   * Scaladoc block comment directly preceding this definition, with the delimiters stripped.
   *
   * Matches Scaladoc blocks only — that is, block comments whose source text starts with
   * three characters: slash, star, star. Plain block comments and `//` line comments are
   * not considered documentation. The opening and closing delimiters, and the Scaladoc
   * "line leader" (`\s*\*\s?` at the start of each line), are removed so the resulting
   * text is the author's prose, ready to render as markdown. Leading and trailing blank
   * lines from the extraction — the almost-always-empty first and last lines of a
   * multi-line Scaladoc — are also trimmed.
   *
   * A doc block counts as "preceding" when it is the nearest comment sibling before the
   * definition at the same source-level container (file root or package body). If any other
   * non-comment node sits between the Scaladoc block and the definition, the doc is
   * **not** attached — that matches the Scala convention where a comment adjacent to one
   * definition documents that definition.
   *
   * Empty string when no Scaladoc precedes the definition, so downstream renderers can
   * short-circuit to a placeholder without null-checking.
   */
  doc: string
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
  /**
   * Most recent Scaladoc block encountered as a sibling before a definition.
   * Cleared whenever we hit a non-comment, non-definition node — this enforces the "adjacent"
   * rule (a doc that precedes an import or a blank anchor doesn't leak onto the next type).
   * Not cleared for plain line or block comments, so a mix of license blurb and Scaladoc
   * still attaches the nearest Scaladoc to the definition that immediately follows.
   */
  let pendingDoc: string | null = null
  for (let i = 0; i < container.namedChildCount; i++) {
    const c = container.namedChild(i)
    if (!c) continue
    if (isScaladocBlock(c)) {
      pendingDoc = stripScaladoc(c.text)
      continue
    }
    // Any other comment (line comment, non-Scaladoc block) does not interrupt the pending doc
    // — this preserves "license header then Scaladoc then class" ordering without surprises.
    if (c.type === 'comment' || c.type === 'block_comment' || c.type === 'line_comment') {
      continue
    }
    const kind = TOP_LEVEL_KINDS[c.type]
    if (!kind) {
      // Non-definition, non-comment node (import, package clause, …): forget the pending doc
      // so it doesn't silently glue onto whatever type appears later in the file.
      pendingDoc = null
      continue
    }
    const name = definitionName(c)
    if (!name) {
      pendingDoc = null
      continue
    }
    out.push({
      kind,
      name,
      startRow: c.startPosition.row,
      endRow: c.endPosition.row,
      parents: extractParents(c),
      paramTypeRefs: extractConstructorParamTypeRefs(c),
      createdTypeRefs: extractCreatedTypeRefs(c),
      constructorParams: extractConstructorParamsSource(c),
      modifiers: extractModifiers(c, kind),
      methodSignatures: extractMethodSignatures(c),
      doc: pendingDoc ?? '',
    })
    pendingDoc = null
  }
  return out
}

/**
 * Recognise a Scaladoc block comment. We accept any tree-sitter comment node whose source
 * text starts with a slash followed by two stars — different grammar versions may label the
 * node `comment`, `block_comment`, or `doc_comment`, and we'd rather be permissive than
 * chase grammar-version drift. Plain block comments and line comments are rejected so only
 * actual documentation blocks end up attached to definitions.
 */
function isScaladocBlock(node: TSNode): boolean {
  const t = node.type
  if (t !== 'comment' && t !== 'block_comment' && t !== 'doc_comment') return false
  const text = node.text
  return typeof text === 'string' && text.startsWith('/**')
}

/**
 * Convert a raw Scaladoc block into the author's prose.
 *
 * Stripping rules, in order:
 *   1. Drop the opening delimiter (`/**` or `/*`) and the closing delimiter (whether it
 *      reads as two characters or the non-standard three-character form some authors use).
 *   2. On every remaining line, drop the Scaladoc "line leader": any leading whitespace, the
 *      optional `*` gutter, and exactly one following space — e.g. `"  * This is."` → `"This is."`.
 *      Lines without a gutter are dedented by the smallest leading-whitespace width that
 *      appears in the block so indented prose doesn't become indented in the output.
 *   3. Trim leading and trailing blank lines so single-line and multi-line blocks both
 *      collapse to just the meaningful text.
 *
 * The output is plain text (with newlines between paragraphs / bullet points) — downstream
 * renderers can show it as-is or feed it to a markdown formatter.
 */
function stripScaladoc(raw: string): string {
  let body = raw.trim()
  if (body.startsWith('/**')) body = body.slice(3)
  else if (body.startsWith('/*')) body = body.slice(2)
  // Accept both `*/` and the non-standard-but-occasionally-seen `**/`.
  if (body.endsWith('**/')) body = body.slice(0, -3)
  else if (body.endsWith('*/')) body = body.slice(0, -2)

  const rawLines = body.split('\n')
  const cleaned = rawLines.map((line) => {
    // Strip Scaladoc line leader: optional leading whitespace, optional `*`, optional single space.
    const m = /^(\s*\*\s?)(.*)$/.exec(line)
    if (m) return m[2] ?? ''
    return line
  })
  // Trim leading / trailing blank lines.
  while (cleaned.length && cleaned[0]!.trim() === '') cleaned.shift()
  while (cleaned.length && cleaned[cleaned.length - 1]!.trim() === '') cleaned.pop()
  return cleaned.join('\n')
}

/**
 * Scan leading tokens of a definition for Scala modifier keywords. Annotations (`@Foo`) and
 * their bracketed arguments are skipped silently so a `@deprecated sealed trait Animal` is
 * read as `['sealed']`. Scanning stops at the first non-modifier token — typically the kind
 * keyword itself (`class`, `trait`, `case`, `object`, …) — which guarantees we never swallow
 * identifiers or misread a signature that happens to embed a modifier word later.
 *
 * `kind` (`'case class'`, `'class'`, …) is the already-resolved display kind; passing it in
 * lets us bail out early when we hit `case` (already part of the kind for `case_class_definition`)
 * or the bare `class` / `trait` / … token that ends the modifier prefix.
 */
const MODIFIER_WORDS = new Set<string>([
  'sealed',
  'abstract',
  'final',
  'implicit',
  'override',
  'lazy',
  'open',
  'inline',
  'transparent',
])
/** Single-token kind keywords plus `case` — any of these terminates the modifier scan. */
const KIND_STOP_WORDS = new Set<string>([
  'case',
  'class',
  'trait',
  'object',
  'enum',
  'def',
  'val',
  'var',
  'type',
  'given',
])
function extractModifiers(defNode: TSNode, _kind: string): string[] {
  const text = defNode.text
  const out: string[] = []
  const tokenRe = /\S+/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(text)) !== null) {
    const tok = m[0]
    if (!tok) break
    if (tok.startsWith('@')) {
      // Annotation head — consume an optional `(...)` argument list that follows the name on the
      // same or subsequent tokens. We keep it simple: skip the current token; the rest of the
      // annotation's arguments will be skipped as long as they don't look like modifiers.
      continue
    }
    // Access qualifier: `private[app]`, `protected[foo.bar]`.
    const qualified = /^(private|protected)(\[.+\])?$/.exec(tok)
    if (qualified) {
      out.push(tok)
      continue
    }
    if (MODIFIER_WORDS.has(tok)) {
      out.push(tok)
      continue
    }
    // Any kind stop word (including `case` for `case class` / `case object`) ends the scan.
    if (KIND_STOP_WORDS.has(tok)) break
    // Unknown token — give up rather than risk grabbing an identifier.
    break
  }
  return out
}

/**
 * Collect capital-case type names referenced from the **primary constructor** parameter lists
 * of a `class` / `case class`. Returns `[]` for other definition kinds.
 *
 * The scan operates on the definition's header text (everything before the class body) with
 * the parent clause removed. Type parameter brackets `[T]` that *precede* the first `(` are
 * dropped — we don't want `T` to look like a used type; the `[...]` *inside* a parameter type
 * (e.g. `Option[Foo]`) is kept, which is exactly what we want.
 *
 * De-duplicated, source order.
 */
function extractConstructorParamTypeRefs(defNode: TSNode): Array<{ name: string; wrapper?: string }> {
  const header = headerTextOf(defNode)
  const paramsText = extractConstructorParamListsText(header)
  if (!paramsText) return []
  const seen = new Set<string>()
  const out: Array<{ name: string; wrapper?: string }> = []
  const re = /\b[A-Z][\w]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(paramsText)) !== null) {
    const name = m[0]
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, wrapper: findImmediateWrapper(paramsText, m.index) })
  }
  return out
}

/**
 * Collect constructor-style calls that create project artefacts:
 *   - `new Foo(...)`
 *   - `Foo(...)`
 *   - `pkg.Foo(...)`
 *
 * We only record capital-case callees and leave actual artefact resolution to the graph layer,
 * which already knows the local artefact index and imports.
 */
function extractCreatedTypeRefs(defNode: TSNode): string[] {
  const body = defNode.childForFieldName('body')
  if (!body) return []
  const text = body.text
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []

  const push = (raw: string | undefined) => {
    const name = (raw ?? '').trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    out.push(name)
  }

  let m: RegExpExecArray | null
  const typeRef = String.raw`(?:[a-z_]\w*\.)*[A-Z]\w*`
  const explicitNew = new RegExp(String.raw`\bnew\s+(${typeRef})\b`, 'g')
  while ((m = explicitNew.exec(text)) !== null) push(m[1])

  const directCtor = new RegExp(String.raw`(^|[^\w.])(${typeRef})\s*(?:\[[^\]]*\])?\s*\(`, 'g')
  while ((m = directCtor.exec(text)) !== null) push(m[2])

  const companionFactory = new RegExp(String.raw`(^|[^\w.])(${typeRef})\s*\.\s*[a-zA-Z_]\w*\s*(?:\[[^\]]*\])?\s*\(`, 'g')
  while ((m = companionFactory.exec(text)) !== null) push(m[2])

  return out
}

function findImmediateWrapper(text: string, pos: number): string | undefined {
  let depth = 0
  for (let i = pos - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === ']') { depth++; continue }
    if (ch === '[') {
      if (depth > 0) { depth--; continue }
      const wm = /\b([A-Z][\w]*)$/.exec(text.slice(0, i).trimEnd())
      return wm?.[1]
    }
    if (depth === 0 && (ch === ':' || ch === '(' || ch === ')')) break
  }
  return undefined
}

/**
 * Extract the concatenated contents of every top-level `(…)` block in a class header, with
 * the `extends … with …` clause chopped off first.
 *
 * Scope:
 *   - Pre-parameter type-parameter brackets (`class Foo[T <: Bar]`) are skipped: we're only
 *     interested in the round-paren parameter lists. Type bounds could be added later if there
 *     is demand.
 *   - Multiple parameter clauses (`class Foo(a: A)(implicit b: B)`) are concatenated.
 *   - Nested `[…]` inside a parameter type (`Option[List[Foo]]`) is preserved — the extraction
 *     keeps characters inside the outermost `(…)` as-is.
 *
 * Returns the empty string when the header has no `(…)` parameter list (traits without ctor,
 * objects, defs, …).
 */
/**
 * Return the source text of every top-level `(…)` parameter clause in a class / case-class
 * header, **with the enclosing parentheses preserved**. Multiple clauses are concatenated
 * (`(a: A)(implicit b: B)`); whitespace inside each clause is collapsed so a wrapped source
 * `class Foo(\n  a: A,\n  b: B,\n)` renders as `(a: A, b: B)` — no trailing commas, no
 * accidental three-line signature in the Arguments panel.
 *
 * Why this sits next to {@link extractConstructorParamListsText}: that helper strips the
 * parens and concatenates only inner characters (its job is type-name extraction). The
 * Arguments panel needs the clauses *as written* so author intent (default values, implicit
 * modifier, repeated clauses) survives to the display.
 *
 * Empty string for kinds without a primary constructor (traits with no ctor, objects, defs,
 * vals, …) and for classes with `[T]` type parameters but no `(…)` runtime arguments.
 */
function extractConstructorParamsSource(defNode: TSNode): string {
  const kind = defNode.type
  if (
    kind !== 'class_definition' &&
    kind !== 'case_class_definition' &&
    kind !== 'trait_definition'
  ) {
    // Objects, defs, vals, types, givens never have a primary-constructor parameter clause
    // in the shape we care about here — don't scan their headers (a `def foo(x: Int)` has a
    // `(…)` that is the method's parameter list, not a class constructor signature).
    return ''
  }
  const header = headerTextOf(defNode)
  /** Cut everything from the first top-level `extends` or `with` keyword, same rule as the type scan. */
  const endKw = /\b(extends|with)\b/.exec(header)
  const scan = endKw ? header.slice(0, endKw.index) : header
  const clauses: string[] = []
  let depth = 0
  let inside = false
  let buf = ''
  for (const ch of scan) {
    if (ch === '(') {
      if (depth === 0) {
        inside = true
        buf = '('
        depth = 1
        continue
      }
      depth++
      buf += ch
      continue
    }
    if (ch === ')') {
      if (!inside) continue
      depth--
      if (depth === 0) {
        inside = false
        buf += ')'
        clauses.push(buf.replace(/\s+/g, ' ').trim())
        buf = ''
        continue
      }
      buf += ch
      continue
    }
    if (inside) buf += ch
  }
  return clauses.join('')
}

function extractConstructorParamListsText(header: string): string {
  /**
   * Cut everything from the first top-level `extends` or `with` keyword. We use a simple regex
   * here because the parent clause of a class can only appear *after* the parameter lists, and
   * the parameter lists themselves can't contain the standalone word `extends`/`with`.
   */
  const endKw = /\b(extends|with)\b/.exec(header)
  const scan = endKw ? header.slice(0, endKw.index) : header
  let out = ''
  let depth = 0
  let inside = false
  for (const ch of scan) {
    if (ch === '(') {
      if (depth === 0) {
        inside = true
        depth = 1
        continue
      }
      depth++
      if (inside) out += ch
      continue
    }
    if (ch === ')') {
      depth--
      if (depth === 0) {
        inside = false
        out += ' '
        continue
      }
      if (inside) out += ch
      continue
    }
    if (inside) out += ch
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
 * Matching strategy: a regex finds every `extends` / `with` keyword and captures the bare
 * parent name (capital-letter, optionally dotted). We then peek forward manually with a
 * bracket-balanced scan to capture the original `[…]` type-argument text (`[Fruit.Apple]`,
 * `[List[Option[Bear]]]`) — nested brackets are common in Scala so a flat regex would clip
 * `extends Eater[Option[Apple]]` at the first `]`. Constructor arguments `(…)` are not part
 * of the type signature we display; the regex naturally stops before them and the scan
 * never enters a `(`.
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
    const afterName = m.index + m[0].length
    const typeArgs = readBalancedBracketSuffix(text, afterName)
    out.push({ kind: keyword, name, ...(typeArgs ? { typeArgs } : {}) })
  }
  return out
}

/**
 * If the next non-whitespace character at `text[start]` is `[`, return the substring from
 * that `[` up to and including its matching `]` (bracket depth balanced). Returns
 * `undefined` when there is no opening bracket or the clause is unclosed (defensive — a
 * malformed source shouldn't throw during live parsing).
 */
function readBalancedBracketSuffix(text: string, start: number): string | undefined {
  let i = start
  while (i < text.length && /\s/.test(text[i]!)) i++
  if (i >= text.length || text[i] !== '[') return undefined
  const open = i
  let depth = 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  return undefined
}

/**
 * Pull one-line signatures of every direct `def` member from the body of a class / trait /
 * object / enum definition. Walks the body's named children (no deep descent — nested
 * classes / companion objects are *not* flattened), captures both concrete `function_definition`
 * and abstract `function_declaration` nodes, trims the body off each one, and collapses
 * whitespace so multi-line signatures read as a single clean line.
 */
function extractMethodSignatures(defNode: TSNode): ParsedScalaMethodSignature[] {
  const body = defNode.childForFieldName('body')
  if (!body) return []
  const out: ParsedScalaMethodSignature[] = []
  for (let i = 0; i < body.namedChildCount; i++) {
    const c = body.namedChild(i)
    if (!c) continue
    if (c.type !== 'function_definition' && c.type !== 'function_declaration') continue
    const sig = oneLineMethodSignature(c)
    if (!sig) continue
    // `startPosition.row` is 0-indexed (tree-sitter convention). Callers that build editor URLs
    // bump to 1 (see `openInEditor`); we keep it 0-indexed here so the value matches the other
    // `startRow` fields on {@link ParsedScalaDefinition}.
    out.push({ signature: sig, startRow: c.startPosition.row, endRow: c.endPosition.row })
  }
  return out
}

/** Full header of a `def` member up to (but not including) its body, collapsed to one line. */
function oneLineMethodSignature(methodNode: TSNode): string {
  const full = methodNode.text
  const body = methodNode.childForFieldName('body')
  let head: string
  if (body && Number.isFinite(body.startIndex) && Number.isFinite(methodNode.startIndex)) {
    const len = body.startIndex - methodNode.startIndex
    head = len > 0 && len <= full.length ? full.slice(0, len) : full
  } else {
    // Abstract `def foo: String` — no body field; the full text IS the signature.
    head = full
  }
  // Drop the `=` that separates header from expression body (concrete defs), if present.
  head = head.replace(/=\s*$/, '')
  // Multi-line signatures → one line; trim redundant spaces so `:  String` becomes `: String`.
  return head.replace(/\s+/g, ' ').trim()
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
