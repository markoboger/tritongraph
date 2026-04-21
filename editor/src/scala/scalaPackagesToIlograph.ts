import type {
  IlographDocument,
  IlographRelation,
  IlographResource,
  TritonInnerArtefactRelationSpec,
  TritonInnerArtefactSpec,
  TritonInnerPackageSpec,
} from '../ilograph/types'
import {
  summarizeScala,
  type ParsedScalaMethodSignature,
  type ParsedScalaParent,
  type ScalaFileSummary,
} from './parseScalaWithTreeSitter'
import type { LoadedScalaFile } from './scalaSourceLoader'
import {
  buildScalaPackageGraphFromSummaries,
  collectScalaArtefactDocs as collectScalaArtefactDocsFromCore,
} from '../../../packages/triton-core/src/scalaPackageGraph.ts'

export interface ScalaArtefact {
  /**
   * Lower-case Scala kind keyword (`class`, `case class`, `object`, `case object`, `trait`,
   * `enum`, `def`, `val`, `var`, `type`, `given`). Mapped 1:1 from tree-sitter node types.
   */
  kind: string
  /** Identifier as written in source (`Bear`, `apply`, `MaxRipeness`). */
  name: string
  /** File the artefact was declared in, relative to project root. */
  file: string
  /**
   * 0-indexed source row where the declaration starts (tree-sitter `startPosition.row`). Used by
   * the "open in editor" click handler to jump to the right line; callers must `+1` when handing
   * to a 1-indexed editor URL scheme (see `editor/src/openInEditor.ts`).
   */
  startRow: number
  /** Fully-qualified package the artefact lives in (`com.example.animalsfruit.animal`). */
  packageName: string
  /** `extends X with Y with Z` parents in source order; empty for top-level defs / vals etc. */
  parents: ParsedScalaParent[]
  /**
   * Simple type names referenced from this artefact's primary constructor parameter list(s).
   * See {@link ParsedScalaDefinition.paramTypeNames}. Empty for kinds without a constructor.
   */
  paramTypeRefs: Array<{ name: string; wrapper?: string }>
  /**
   * Source text of the primary constructor parameter clauses (with parens preserved, whitespace
   * collapsed). See {@link ParsedScalaDefinition.constructorParams}. Empty for objects / traits
   * without a ctor / defs / vals.
   *
   * Rendered in the focused "Arguments" panel as a Shiki-highlighted Scala snippet, prefixed
   * with `class Name` so the highlighter has a syntactic anchor ("bare" tuples aren't valid
   * Scala and render poorly). Kept out of the YAML via `slimInnerArtefactForExport` — it's
   * scanner-derived prose that belongs to the source code, not the diagram structure.
   */
  constructorParams: string
  /**
   * Leading Scala modifier keywords in source order (`sealed`, `abstract`, `final`, `private`,
   * `private[app]`, …). Empty when none apply. Carried so the rendered declaration retains
   * qualifiers that affect meaning (`sealed trait` ≠ `trait`, `abstract class` ≠ `class`).
   */
  modifiers: string[]
  /**
   * One-line signatures of `def` members declared directly inside this artefact, with a
   * 0-indexed source row per entry so the focused Methods panel can wire each signature
   * as a click-to-open-at-line action. See {@link ParsedScalaDefinition.methodSignatures}
   * for extraction scope / normalisation.
   */
  methodSignatures: ParsedScalaMethodSignature[]
  /**
   * One-line human-readable declaration — `"{modifiers} {kind} {name}"` with the original
   * `extends … with …` chain appended when parents are present (`"sealed trait Animal extends Named"`,
   * `"object Demo extends App"`). Constructor parameter lists are intentionally omitted so this
   * stays short enough for a focused box header.
   *
   * Built once at parse time (in {@link buildScalaPackageGraph}) so every downstream consumer
   * (ilograph resource, focused box subtitle, markdown descriptions …) renders identical text.
   */
  declaration: string
  /**
   * Scaladoc preceding this artefact in source, with opening `/**`, closing delimiter, and
   * per-line `*` gutters stripped. Empty string when no Scaladoc block precedes the
   * definition. See {@link ParsedScalaDefinition.doc} for the stripping rules.
   *
   * Held in-memory only and mirrored into the TinyBase overlay store under the `scalaDocs`
   * table keyed by artefact resource id — see `App.loadScalaPackagesForExample`. Intentionally
   * **not** emitted into the Ilograph YAML (the YAML should stay source-structure-only;
   * Scaladoc is scanned freshly from `.scala` sources on every load so persisting it would
   * add diff noise for no benefit).
   */
  doc: string
}

export interface ScalaInheritanceEdge {
  /** Parent (more abstract) artefact id — laid out to the LEFT (lower depth). */
  fromArtefactId: string
  /** Child (more concrete) artefact id — laid out to the RIGHT (higher depth). */
  toArtefactId: string
  /** `extends` for the primary parent of the child; `with` for stacked traits. */
  kind: 'extends' | 'with'
}

/**
 * "Uses" relation: an artefact's primary constructor takes another known artefact as a parameter
 * (directly or as the inner type of a generic wrapper — see {@link resolveGetsEdges}).
 * Rendered with its own stroke / marker so it reads as a structural reference rather than
 * inheritance. Directed `getter → dependency` (consumer on the left face of the edge).
 */
export interface ScalaGetsEdge {
  /** The class that declares the constructor parameter — the "getter". */
  fromArtefactId: string
  /** The artefact referenced by that parameter's type — the dependency. */
  toArtefactId: string
  kind: 'gets'
  wrapperName?: string
}

export interface ScalaPackageNode {
  /** Fully-qualified package name (`com.example.core`). Files without a package land in `<root>`. */
  name: string
  /** Files belonging to this package (path relative to project root). */
  files: string[]
  /** Top-level Scala artefacts (classes / objects / traits / enums / top-level defs etc.). */
  artefacts: ScalaArtefact[]
}

export interface ScalaPackageEdge {
  /** Source package (the importer). */
  from: string
  /** Target package (the imported). */
  to: string
  /** How many distinct (file, import) pairs contribute to this edge. */
  weight: number
}

export interface ScalaPackageGraph {
  packages: ScalaPackageNode[]
  edges: ScalaPackageEdge[]
  /** `extends` / `with` relations between artefacts (resolved by simple-name lookup). */
  inheritance: ScalaInheritanceEdge[]
  /**
   * "Gets" relations inferred from primary-constructor parameter types — getter → dependency. Unlike
   * `inheritance`, these don't contribute to the inner artefact column layout (children still
   * land in the column right of their parents); they are purely overlays on the same layout.
   */
  gets: ScalaGetsEdge[]
  /**
   * Top-level Scala artefacts discovered under `src/test/scala`.
   *
   * These are intentionally **not** emitted into the diagram/YAML (the user asked to ignore test
   * sources in the diagram), but we still keep them so the UI can link from "tested by" lists to
   * real spec source locations.
   */
  testArtefacts: ScalaArtefact[]
}

const ROOT_PACKAGE = '<root>'

/**
 * Parse every file with tree-sitter, then aggregate into packages + import-derived edges.
 * Self-edges (a package importing from itself) are dropped — they are noise in a package graph.
 */
export async function buildScalaPackageGraph(
  files: readonly LoadedScalaFile[],
): Promise<ScalaPackageGraph> {
  const summaries = await Promise.all(
    files.map(async (f) => ({ file: f, summary: await summarizeScala(f.source) } as { file: LoadedScalaFile; summary: ScalaFileSummary })),
  )
  return buildScalaPackageGraphFromSummaries(summaries)
}

/**
 * Walk every artefact's `paramTypeNames` (simple names collected from the primary constructor
 * parameter list — see {@link ParsedScalaDefinition.paramTypeNames}) and resolve each to a
 * known artefact using the same machinery as inheritance parents.
 *
 * Stdlib and third-party types (`String`, `Int`, `Option`, `Try`, `Future`, `cats.effect.IO`,
 * …) are NOT in the local artefact index, so {@link resolveParentName} returns `undefined`
 * for them — they are silently dropped. This matches the user requirement: ignore stdlib
 * types, and for generic wrappers keep the *inner* type (`Option[Foo]` contributes only the
 * resolved `Foo`, the wrapper `Option` drops on its own).
 *
 * Self-uses (a class taking itself as a parameter — rare but legal, e.g. recursive ADTs) are
 * skipped to avoid a self-loop edge cluttering the diagram.
 */
function resolveGetsEdges(
  packages: readonly ScalaPackageNode[],
  summaries: readonly { file: LoadedScalaFile; summary: ScalaFileSummary }[],
): ScalaGetsEdge[] {
  const artefactById = new Map<string, ScalaArtefact>()
  const bySimpleName = new Map<string, ScalaArtefact[]>()
  const byPackage = new Map<string, ScalaArtefact[]>()
  for (const p of packages) {
    byPackage.set(p.name, p.artefacts)
    for (const a of p.artefacts) {
      artefactById.set(artefactResourceId(a.packageName, a), a)
      const bucket = bySimpleName.get(a.name) ?? []
      bucket.push(a)
      bySimpleName.set(a.name, bucket)
    }
  }
  const summaryByFile = new Map<string, ScalaFileSummary>()
  for (const s of summaries) summaryByFile.set(s.file.relPath, s.summary)

  const out: ScalaGetsEdge[] = []
  const seen = new Set<string>()
  for (const p of packages) {
    const samePackageArtefacts = byPackage.get(p.name) ?? []
    for (const user of p.artefacts) {
      const userId = artefactResourceId(user.packageName, user)
      const summary = summaryByFile.get(user.file)
      const imports = summary?.imports ?? []
      for (const ref of user.paramTypeRefs) {
        const usedArt = resolveParentName(ref.name, {
          samePackageArtefacts,
          imports,
          bySimpleName,
          artefactById,
        })
        if (!usedArt) continue
        const usedId = artefactResourceId(usedArt.packageName, usedArt)
        if (usedId === userId) continue
        const key = `${userId}\u0001${usedId}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ fromArtefactId: userId, toArtefactId: usedId, kind: 'gets', wrapperName: ref.wrapper })
      }
    }
  }
  out.sort((a, b) =>
    a.toArtefactId === b.toArtefactId
      ? a.fromArtefactId.localeCompare(b.fromArtefactId)
      : a.toArtefactId.localeCompare(b.toArtefactId),
  )
  return out
}

interface ResolveCtx {
  samePackageArtefacts: readonly ScalaArtefact[]
  imports: ReadonlyArray<{ prefix: string; selectors: string[] }>
  bySimpleName: ReadonlyMap<string, readonly ScalaArtefact[]>
  artefactById: ReadonlyMap<string, ScalaArtefact>
}

function resolveParentName(rawName: string, ctx: ResolveCtx): ScalaArtefact | undefined {
  if (!rawName) return undefined
  /**
   * Dotted parent names (`Outer.Inner` / `pkg.Foo`) point at a specific FQN. We try to match the
   * full chain first; if the user wrote `pkg.SubPkg.Foo` that's a fully-qualified parent — try
   * `<pkg.SubPkg>::<kind>:Foo` for every known kind. We don't know the kind here, so we fall
   * back to "any artefact with that simple name in that package".
   */
  const dotIdx = rawName.lastIndexOf('.')
  if (dotIdx > 0) {
    const explicitPkg = rawName.slice(0, dotIdx)
    const simple = rawName.slice(dotIdx + 1)
    const pkgArtefacts = artefactsInPackage(explicitPkg, ctx)
    const hit = pkgArtefacts.find((a) => a.name === simple)
    if (hit) return hit
    /** Don't fall through for dotted names — they're FQNs, ambiguity here means an unknown type. */
    return undefined
  }

  const simple = rawName

  // 1. Same package as the child.
  const samePkgHit = ctx.samePackageArtefacts.find((a) => a.name === simple)
  if (samePkgHit) return samePkgHit

  // 2. Wildcard imports — `import pkg._` brings every member of `pkg` into scope.
  for (const imp of ctx.imports) {
    if (!imp.selectors.includes('_')) continue
    const pkgArtefacts = artefactsInPackage(imp.prefix, ctx)
    const hit = pkgArtefacts.find((a) => a.name === simple)
    if (hit) return hit
  }

  // 3. Explicit imports — `import pkg.{Foo, Bar}` or `import pkg.Foo`.
  for (const imp of ctx.imports) {
    if (!imp.selectors.includes(simple)) continue
    const pkgArtefacts = artefactsInPackage(imp.prefix, ctx)
    const hit = pkgArtefacts.find((a) => a.name === simple)
    if (hit) return hit
  }

  // 4. Globally unique simple name.
  const candidates = ctx.bySimpleName.get(simple) ?? []
  if (candidates.length === 1) return candidates[0]
  return undefined
}

function artefactsInPackage(packageFqn: string, ctx: ResolveCtx): ScalaArtefact[] {
  const out: ScalaArtefact[] = []
  for (const a of ctx.artefactById.values()) {
    if (a.packageName === packageFqn) out.push(a)
  }
  return out
}

function dedupeSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

/**
 * Two artefacts that share `kind` + `name` + `file` are the same declaration encountered twice
 * (shouldn't normally happen, but the loader can list a file under multiple roots in tests). We
 * sort by name so package boxes get a stable child order — which keeps the layered layout's
 * stable-by-id sort meaningful and the diagram visually quiet across re-renders.
 */
function dedupeArtefacts(values: readonly ScalaArtefact[]): ScalaArtefact[] {
  const seen = new Set<string>()
  const out: ScalaArtefact[] = []
  for (const a of values) {
    const key = `${a.kind}\u0001${a.name}\u0001${a.file}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  out.sort((a, b) => (a.name === b.name ? a.kind.localeCompare(b.kind) : a.name.localeCompare(b.name)))
  return out
}

/* ------------------------------------------------------------------------------------------------
 * Containment hierarchy
 *
 * A package's name is its `package com.example.foo` declaration; the directory under
 * `src/main/scala` is just where `sbt` happens to put it on disk and is irrelevant to the
 * containment view. We build a dotted-prefix trie from the FQNs and then *collapse linear chains*
 * — a node with zero own files and exactly one child is merged into that child, joining their
 * segments with `.`. So a tree like:
 *
 *     com → example → animalsfruit (Demo.scala)
 *                       ├── animal
 *                       ├── fruit
 *                       └── relation
 *
 * renders as a single top-level container `com.example.animalsfruit` (own file = `Demo.scala`)
 * holding three sub-package boxes named `animal`, `fruit`, `relation`. Containment is conveyed by
 * nesting under that scope (`parentNode` / `group`). **Cross-package** use (wildcard or
 * explicit `import otherPkg.Type`) becomes `imports` edges, laid out LR like sbt `depends on`.
 * ---------------------------------------------------------------------------------------------- */

interface PackageTreeNode {
  /** Fully qualified package name at this point in the tree (`com.example.animalsfruit.animal`). */
  fqn: string
  /** Display name relative to the parent (post-collapse). For a top-level chain that collapsed all the way down to `com.example.animalsfruit`, this is the dotted joined string. */
  segment: string
  files: string[]
  artefacts: ScalaArtefact[]
  children: PackageTreeNode[]
}

function buildPackageTree(packages: readonly ScalaPackageNode[]): PackageTreeNode {
  const root: PackageTreeNode = { fqn: '', segment: '', files: [], artefacts: [], children: [] }
  for (const p of packages) {
    if (p.name === ROOT_PACKAGE) {
      root.files.push(...p.files)
      root.artefacts.push(...p.artefacts)
      continue
    }
    const segs = p.name.split('.').filter(Boolean)
    let cursor = root
    let prefix = ''
    for (const seg of segs) {
      prefix = prefix ? `${prefix}.${seg}` : seg
      let child = cursor.children.find((c) => c.segment === seg)
      if (!child) {
        child = { fqn: prefix, segment: seg, files: [], artefacts: [], children: [] }
        cursor.children.push(child)
      }
      cursor = child
    }
    cursor.files.push(...p.files)
    cursor.artefacts.push(...p.artefacts)
  }
  return root
}

/**
 * Collapse linear single-child chains: a node with **zero own files** and **exactly one child**
 * is merged into that child (segment joined by `.`, fqn / files / artefacts / children inherited).
 * Recurses into surviving children.
 */
function collapseLinearChains(node: PackageTreeNode): PackageTreeNode {
  let cur: PackageTreeNode = node
  while (cur.children.length === 1 && cur.files.length === 0) {
    const child = cur.children[0]
    cur = {
      fqn: child.fqn,
      segment: cur.segment ? `${cur.segment}.${child.segment}` : child.segment,
      files: child.files,
      artefacts: child.artefacts,
      children: child.children,
    }
  }
  return {
    ...cur,
    children: cur.children.map(collapseLinearChains),
  }
}

/** Stable, container-unique id for an artefact resource. Distinct from package FQNs so the
 *  rendered-fqn set is unambiguous. Format: `<packageFqn>::<kind>:<name>`.
 *  Kind goes into the id to disambiguate when the same name has both a `class` and a same-named
 *  `object` (companion object pattern) in the same package. */
function artefactResourceId(packageFqn: string, art: ScalaArtefact): string {
  const safeKind = art.kind.replace(/\s+/g, '-')
  const root = packageFqn || ROOT_PACKAGE
  return `${root}::${safeKind}:${art.name}`
}

/**
 * Flatten the scanner graph into `{ id, doc }` pairs for every artefact that carries Scaladoc.
 *
 * Consumed by `App.loadScalaPackagesForExample` to seed the TinyBase `scalaDocs` table on each
 * scan: since Scaladoc is scanner-derived (refreshed every load) it lives in TinyBase rather
 * than the YAML, and callers need the same resource ids we use for flow nodes so the box
 * component can look up its doc by `boxId`. Artefacts without documentation are omitted — the
 * UI treats an absent row as "show the placeholder" without needing an explicit clear.
 */
export function collectScalaArtefactDocs(
  graph: ScalaPackageGraph,
): Array<{ id: string; doc: string }> {
  return collectScalaArtefactDocsFromCore(graph)
}

/** Stable inner-list entries for artefacts declared in this package (layer-drill UI only). */
function innerArtefactSpecsForNode(n: PackageTreeNode): TritonInnerArtefactSpec[] {
  if (!n.artefacts.length) return []
  return dedupeArtefacts(n.artefacts)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
    .map((a) => ({
      id: artefactResourceId(n.fqn, a),
      name: a.name,
      subtitle: a.kind,
      declaration: a.declaration,
      ...(a.constructorParams ? { constructorParams: a.constructorParams } : {}),
      ...(a.methodSignatures.length ? { methodSignatures: a.methodSignatures } : {}),
      ...(a.file ? { sourceFile: a.file } : {}),
      ...(Number.isFinite(a.startRow) ? { sourceRow: a.startRow } : {}),
    }))
}

/**
 * `extends` / `with` / `uses` between inner-list members only (both ends must live in this
 * package's artefact set, otherwise we'd draw an edge to a box the viewer can't see).
 *
 * The edges are emitted in label-priority order (`extends` → `with` → `uses`) so the `seen`
 * set de-duplicates an artefact pair to its *structural* relation when both exist — a class
 * that both `extends Animal` and takes `Animal` as a constructor parameter renders as `extends`
 * only; drawing both would be visual noise.
 */
function innerArtefactRelationSpecsForNode(
  n: PackageTreeNode,
  graph: ScalaPackageGraph,
): TritonInnerArtefactRelationSpec[] {
  const innerArts = innerArtefactSpecsForNode(n)
  if (innerArts.length < 2) return []
  const idSet = new Set(innerArts.map((a) => a.id))
  const out: TritonInnerArtefactRelationSpec[] = []
  /** Keyed by endpoint pair only — stronger structural labels win over `uses`. */
  const seenPair = new Set<string>()
  for (const e of graph.inheritance) {
    if (!idSet.has(e.fromArtefactId) || !idSet.has(e.toArtefactId)) continue
    const pairKey = `${e.fromArtefactId}\u0001${e.toArtefactId}`
    if (seenPair.has(pairKey)) continue
    seenPair.add(pairKey)
    const label: TritonInnerArtefactRelationSpec['label'] = e.kind === 'with' ? 'with' : 'extends'
    out.push({ from: e.fromArtefactId, to: e.toArtefactId, label })
  }
  for (const e of graph.gets) {
    if (!idSet.has(e.fromArtefactId) || !idSet.has(e.toArtefactId)) continue
    const pairKey = `${e.fromArtefactId}\u0001${e.toArtefactId}`
    if (seenPair.has(pairKey)) continue
    seenPair.add(pairKey)
    out.push({ from: e.fromArtefactId, to: e.toArtefactId, label: 'gets', wrapperName: e.wrapperName })
  }
  out.sort((a, b) => (a.to === b.to ? a.from.localeCompare(b.from) : a.to.localeCompare(b.to)))
  return out
}

/**
 * Cross-package artefact edges for a package node: edges from `graph` where exactly ONE
 * endpoint is an artefact in this package and the other belongs to a different package.
 * Used by PackageBox to filter its artefacts when a foreign artefact is globally focused.
 */
function crossPackageArtefactRelationSpecsForNode(
  n: PackageTreeNode,
  graph: ScalaPackageGraph,
): TritonInnerArtefactRelationSpec[] {
  const innerArts = innerArtefactSpecsForNode(n)
  if (!innerArts.length) return []
  const idSet = new Set(innerArts.map((a) => a.id))
  const out: TritonInnerArtefactRelationSpec[] = []
  const seenPair = new Set<string>()

  for (const e of graph.inheritance) {
    const fromLocal = idSet.has(e.fromArtefactId)
    const toLocal = idSet.has(e.toArtefactId)
    if (fromLocal === toLocal) continue
    const pairKey = `${e.fromArtefactId}\u0001${e.toArtefactId}`
    if (seenPair.has(pairKey)) continue
    seenPair.add(pairKey)
    const label: TritonInnerArtefactRelationSpec['label'] = e.kind === 'with' ? 'with' : 'extends'
    out.push({ from: e.fromArtefactId, to: e.toArtefactId, label })
  }

  for (const e of graph.gets) {
    const fromLocal = idSet.has(e.fromArtefactId)
    const toLocal = idSet.has(e.toArtefactId)
    if (fromLocal === toLocal) continue
    const pairKey = `${e.fromArtefactId}\u0001${e.toArtefactId}`
    if (seenPair.has(pairKey)) continue
    seenPair.add(pairKey)
    out.push({ from: e.fromArtefactId, to: e.toArtefactId, label: 'gets', wrapperName: e.wrapperName })
  }

  out.sort((a, b) => (a.to === b.to ? a.from.localeCompare(b.from) : a.to.localeCompare(b.to)))
  return out
}

/** All `.scala` paths under this subtree (for the root-only package summary). */
function collectSubtreeFiles(node: PackageTreeNode): string[] {
  const out = new Set<string>(node.files)
  for (const c of node.children) {
    for (const f of collectSubtreeFiles(c)) out.add(f)
  }
  return dedupeSortedStrings([...out])
}

/** One package node → nested spec (recursive `innerPackages` for inner drill). */
function packageNodeToInnerSpec(n: PackageTreeNode): TritonInnerPackageSpec {
  const files = collectSubtreeFiles(n)
  const nSub = n.children.length
  const parts: string[] = []
  if (nSub) parts.push(`${nSub} sub-package${nSub === 1 ? '' : 's'}`)
  parts.push(`${files.length} file${files.length === 1 ? '' : 's'}`)
  const innerChildSpecs: TritonInnerPackageSpec[] = n.children.length
    ? n.children
        .map((c) => collapseLinearChains(c))
        .sort((a, b) => (a.segment || a.fqn).localeCompare(b.segment || b.fqn))
        .map(packageNodeToInnerSpec)
    : []
  return {
    id: n.fqn,
    name: n.segment || n.fqn,
    subtitle: parts.join(' · '),
    ...(innerChildSpecs.length ? { innerPackages: innerChildSpecs } : {}),
  }
}

/** Direct children of the outer picked package as nested specs (each may contain deeper packages). */
function rootInnerPackageSpecs(picked: PackageTreeNode): TritonInnerPackageSpec[] {
  return picked.children
    .map((c) => collapseLinearChains(c))
    .sort((a, b) => (a.segment || a.fqn).localeCompare(b.segment || b.fqn))
    .map(packageNodeToInnerSpec)
}

/**
 * Single outermost package leaf: one Vue Flow `package` node filling the viewport. Child packages
 * are not separate nodes; they are listed under `x-triton-inner-packages` and rendered when the
 * box is layer-drill focused (stacked inner package shells).
 */
function rootOnlyPackageLeafResource(node: PackageTreeNode, graph: ScalaPackageGraph): IlographResource {
  // Description used to list the package fqn + every source file — all data that is already
  // redundantly encoded by `id` (= fqn) and by the scanner re-reading `.scala` sources on every
  // load. We skip it so the exported YAML carries only the structural graph and diffs stay
  // focused on real code changes (renames, new artefacts, new edges) instead of file-listing noise.
  const files = collectSubtreeFiles(node)
  const name = node.segment || node.fqn || ROOT_PACKAGE
  const inner = rootInnerPackageSpecs(node)
  const innerArts = innerArtefactSpecsForNode(node)
  const innerRels = innerArtefactRelationSpecsForNode(node, graph)
  const crossRels = crossPackageArtefactRelationSpecsForNode(node, graph)
  return {
    id: node.fqn || ROOT_PACKAGE,
    name,
    subtitle: formatArtefactBreakdown(node.artefacts, files.length),
    ...(inner.length ? { 'x-triton-inner-packages': inner } : {}),
    ...(innerArts.length ? { 'x-triton-inner-artefacts': innerArts } : {}),
    ...(innerRels.length ? { 'x-triton-inner-artefact-relations': innerRels } : {}),
    ...(crossRels.length ? { 'x-triton-cross-artefact-relations': crossRels } : {}),
  }
}

/** Every package FQN in `picked`’s subtree (including `picked` itself) for import-edge filtering. */
function collectSubtreePackageFqns(picked: PackageTreeNode): Set<string> {
  const s = new Set<string>()
  function walk(n: PackageTreeNode) {
    const c = collapseLinearChains(n)
    s.add(c.fqn)
    for (const ch of c.children) walk(ch)
  }
  walk(picked)
  return s
}

/**
 * Every **proper** descendant package of `picked` as a flat list of `package` leaves (no
 * `x-triton-inner-packages`): each FQN is a Vue Flow node under the outer group so all `imports`
 * edges in the subtree can attach to real endpoints and get LR layout.
 */
function flattenDescendantPackageResources(
  picked: PackageTreeNode,
  graph: ScalaPackageGraph,
): IlographResource[] {
  const out: IlographResource[] = []
  function visit(n: PackageTreeNode) {
    const c = collapseLinearChains(n)
    for (const ch of c.children) {
      const cc = collapseLinearChains(ch)
      out.push(packageLeafResourceForGraph(cc, graph))
      visit(ch)
    }
  }
  visit(picked)
  out.sort((a, b) => String(a.id ?? a.name).localeCompare(String(b.id ?? b.name)))
  return out
}

function packageLeafResourceForGraph(n: PackageTreeNode, graph: ScalaPackageGraph): IlographResource {
  // Same rationale as `rootOnlyPackageLeafResource`: description was pure boilerplate
  // (fqn + file list, both recoverable from the scan) and is dropped from the YAML.
  const c = collapseLinearChains(n)
  const files = collectSubtreeFiles(c)
  const innerArts = innerArtefactSpecsForNode(c)
  const innerRels = innerArtefactRelationSpecsForNode(c, graph)
  const crossRels = crossPackageArtefactRelationSpecsForNode(c, graph)
  return {
    id: c.fqn,
    name: c.segment || c.fqn,
    subtitle: formatArtefactBreakdown(c.artefacts, files.length),
    'x-triton-node-type': 'package',
    ...(innerArts.length ? { 'x-triton-inner-artefacts': innerArts } : {}),
    ...(innerRels.length ? { 'x-triton-inner-artefact-relations': innerRels } : {}),
    ...(crossRels.length ? { 'x-triton-cross-artefact-relations': crossRels } : {}),
  }
}

/**
 * Package subtitle: breakdown of the top-level Scala artefacts declared directly in this
 * package, grouped by kind (classes, traits, objects, enums, defs). Falls back to a file
 * count for artefact-free packages so the chrome never renders an empty subtitle. Companion
 * `case` variants fold into their base kind (`case class` → class, `case object` → object)
 * because the headline count answers "how many types live here" — the `case` modifier is a
 * declaration detail visible on the drilled-in artefact card.
 */
function formatArtefactBreakdown(artefacts: readonly ScalaArtefact[], fileCount: number): string {
  if (!artefacts.length) {
    return `${fileCount} Scala file${fileCount === 1 ? '' : 's'}`
  }
  let classes = 0
  let traits = 0
  let objects = 0
  let enums = 0
  let defs = 0
  for (const a of artefacts) {
    switch (a.kind) {
      case 'class':
      case 'case class':
        classes += 1
        break
      case 'trait':
        traits += 1
        break
      case 'object':
      case 'case object':
        objects += 1
        break
      case 'enum':
        enums += 1
        break
      case 'def':
        defs += 1
        break
      default:
        break
    }
  }
  const parts: string[] = []
  if (classes) parts.push(`${classes} ${classes === 1 ? 'Class' : 'Classes'}`)
  if (traits) parts.push(`${traits} ${traits === 1 ? 'Trait' : 'Traits'}`)
  if (objects) parts.push(`${objects} ${objects === 1 ? 'Object' : 'Objects'}`)
  if (enums) parts.push(`${enums} ${enums === 1 ? 'Enum' : 'Enums'}`)
  if (defs) parts.push(`${defs} ${defs === 1 ? 'Def' : 'Defs'}`)
  if (!parts.length) {
    return `${fileCount} Scala file${fileCount === 1 ? '' : 's'}`
  }
  return parts.join(', ')
}

/**
 * Detect the source language of a subtree from file paths. Priority:
 *
 *   1. The `src/main/<lang>/…` Maven / sbt / Gradle convention — counts the segment directly
 *      under `src/main/` across every file and returns the dominant one. Works for multi-language
 *      repos that follow the convention (`src/main/scala` vs. `src/main/java` vs. `src/main/kotlin`).
 *   2. Fallback: dominant file extension (`.scala`, `.java`, `.kt`, `.ts` / `.tsx`, `.js` / `.jsx`,
 *      `.py`, `.rb`, `.go`, `.rs`, `.swift`).
 *
 * Returns `undefined` when nothing can be inferred — caller then omits the logo entirely
 * instead of guessing. Normalized to one of the `LanguageIconId` keys declared in
 * `editor/src/graph/languages.ts` (`scala`, `java`, `kotlin`, `ts`, `js`, `python`, `ruby`,
 * `go`, `rust`, `swift`) so the downstream `LanguageIcon` component resolves the asset directly.
 */
function detectLanguageFromFilePaths(files: readonly string[]): string | undefined {
  if (!files.length) return undefined
  const dirCounts = new Map<string, number>()
  for (const f of files) {
    const m = /(?:^|\/)src\/main\/([^/]+)\//.exec(f)
    if (!m) continue
    const dir = m[1]!.toLowerCase()
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1)
  }
  if (dirCounts.size > 0) {
    const top = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    if (top === 'scala') return 'scala'
    if (top === 'java' || top === 'groovy') return 'java'
    if (top === 'kotlin') return 'kotlin'
    if (top === 'typescript') return 'ts'
    if (top === 'javascript') return 'js'
    if (top === 'python') return 'python'
    if (top === 'ruby') return 'ruby'
    if (top === 'go') return 'go'
    if (top === 'rust') return 'rust'
    if (top === 'swift') return 'swift'
    return undefined
  }
  const extCounts = new Map<string, number>()
  for (const f of files) {
    const dot = f.lastIndexOf('.')
    if (dot < 0) continue
    const ext = f.slice(dot + 1).toLowerCase()
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
  }
  if (!extCounts.size) return undefined
  const topExt = [...extCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
  switch (topExt) {
    case 'scala':
      return 'scala'
    case 'java':
      return 'java'
    case 'kt':
    case 'kts':
      return 'kotlin'
    case 'ts':
    case 'tsx':
      return 'ts'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'js'
    case 'py':
      return 'python'
    case 'rb':
      return 'ruby'
    case 'go':
      return 'go'
    case 'rs':
      return 'rust'
    case 'swift':
      return 'swift'
    default:
      return undefined
  }
}

/**
 * Each top-level Scala artefact declared directly under the outer scope (e.g. `Demo` and
 * `FoxAppleEater` in `com.example.animalsfruit/Demo.scala`) becomes its own **artefact** leaf
 * inside the scope group — a sibling to the sub-package leaves. This is the only way the
 * user sees "the package has subpackages AND its own classes" at a glance: a single `Demo`
 * box next to `animal`, `fruit`, `relation`, etc. (Wrapping them in a synthetic self-package
 * leaf hid them one extra click deep; drilling the scope group was the only way to reveal
 * `Demo`, which read as "missing" at the top level.)
 *
 * Artefact leaves use `x-triton-node-type: 'artefact'` so Vue Flow renders them via the
 * `ScalaArtefactBox` path in {@link FlowPackageNode}. Their id is the same `artefactResourceId`
 * used for inner-list entries, so {@link ScalaInheritanceEdge} / {@link ScalaGetsEdge}
 * endpoints line up if we ever emit artefact-level relations at the scope level.
 */
function scopeDirectArtefactLeafResources(scope: PackageTreeNode): IlographResource[] {
  if (!scope.artefacts.length) return []
  return dedupeArtefacts(scope.artefacts)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
    .map((a) => {
      // Description used to repeat `Scala <kind>: <name>` / `Package: <fqn>` / `File: <relPath>`,
      // all of which are already surfaced via `name`, the enclosing group id, and the new
      // `x-triton-source-file` field respectively. Dropped to keep the YAML lean.
      const id = artefactResourceId(scope.fqn, a)
      return {
        id,
        name: a.name,
        subtitle: a.kind,
        'x-triton-node-type': 'artefact',
        'x-triton-declaration': a.declaration,
        ...(a.constructorParams ? { 'x-triton-constructor-params': a.constructorParams } : {}),
        ...(a.methodSignatures.length ? { 'x-triton-method-signatures': a.methodSignatures } : {}),
        ...(a.file ? { 'x-triton-source-file': a.file } : {}),
        ...(Number.isFinite(a.startRow) ? { 'x-triton-source-row': a.startRow } : {}),
      } as IlographResource
    })
}

/**
 * Outer picked scope as a **group** (`x-triton-package-scope`): package-style chrome in
 * {@link GroupNode}. All descendant packages are **flat** child resources for dependency layout,
 * and — when the scope itself owns files / artefacts — a synthetic "self" leaf is added so the
 * scope's own classes show up next to its sub-packages instead of being hidden by the group.
 */
function pickedPackageGroupResource(picked: PackageTreeNode, graph: ScalaPackageGraph): IlographResource {
  const top = collapseLinearChains(picked)
  const files = collectSubtreeFiles(top)
  const name = top.segment || top.fqn || ROOT_PACKAGE
  const descendantResources = flattenDescendantPackageResources(top, graph)
  const directArtefactLeaves = scopeDirectArtefactLeafResources(top)
  const childResources = directArtefactLeaves.length
    ? [...directArtefactLeaves, ...descendantResources].sort((a, b) =>
        String(a.id ?? a.name).localeCompare(String(b.id ?? b.name)),
      )
    : descendantResources
  const language = detectLanguageFromFilePaths(files)
  // Description used to list fqn, detected language, and every source file — all already
  // captured via `id`, `x-triton-package-language`, and the scanner's fresh source reads.
  // Dropping it keeps the outer group YAML to a few structural fields only.
  const subtitleParts: string[] = []
  subtitleParts.push(`${files.length} Scala file${files.length === 1 ? '' : 's'}`)
  const pkgCount = descendantResources.length
  if (pkgCount) {
    subtitleParts.push(`${pkgCount} nested package${pkgCount === 1 ? '' : 's'}`)
  }
  if (directArtefactLeaves.length) {
    subtitleParts.push(
      `${directArtefactLeaves.length} direct ${directArtefactLeaves.length === 1 ? 'artefact' : 'artefacts'}`,
    )
  }
  return {
    id: top.fqn,
    name,
    subtitle: subtitleParts.join(' · '),
    'x-triton-package-scope': true,
    ...(language ? { 'x-triton-package-language': language } : {}),
    children: childResources,
  }
}

/**
 * All `imports` edges whose endpoints lie in the picked subtree (any depth).
 * `buildScalaPackageGraph` already drops strict-ancestor → descendant imports (containment),
 * so the outer scope FQN itself never appears as an edge endpoint here — it's the group
 * id, not a leaf, and Vue Flow would silently drop edges attached to it anyway.
 */
function relationsInPickedSubtree(graph: ScalaPackageGraph, picked: PackageTreeNode): IlographRelation[] {
  const endpoints = collectSubtreePackageFqns(picked)
  const out: IlographRelation[] = []
  for (const edge of graph.edges) {
    if (!endpoints.has(edge.from) || !endpoints.has(edge.to)) continue
    out.push({
      from: edge.from,
      to: edge.to,
      label: 'imports',
      arrowDirection: 'forward',
    })
  }
  out.sort((a, b) =>
    String(a.from).localeCompare(String(b.from)) || String(a.to).localeCompare(String(b.to)),
  )
  return out
}

/** When several top-level collapsed chains exist, pick one deterministically (alphabetical FQN). */
function pickOutermostPackageNode(collapsedTop: PackageTreeNode[]): PackageTreeNode | null {
  if (!collapsedTop.length) return null
  if (collapsedTop.length === 1) return collapsedTop[0]!
  return [...collapsedTop].sort((a, b) => a.fqn.localeCompare(b.fqn))[0]!
}

/**
 * Render a {@link ScalaPackageGraph} as an Ilograph document.
 *
 * When the picked outer scope has **sub-packages**, the outer scope is a **group** with
 * `x-triton-package-scope` (package-style frame); **every** descendant package is a flat child
 * `package` node so all `imports` edges in the subtree participate in LR layout.
 * Otherwise a single leaf with `x-triton-inner-packages` is used (no import edges to lay out).
 */
export function scalaPackageGraphToIlographDocument(
  graph: ScalaPackageGraph,
  meta: { title?: string; sourcePath?: string } = {},
): IlographDocument {
  const root = buildPackageTree(graph.packages)
  /** Collapse each top-level subtree independently so siblings don't get merged with each other. */
  const collapsedTop = root.children.map((c) => collapseLinearChains(c))

  let topResources: IlographResource[]
  let relations: IlographRelation[] = []

  const picked = pickOutermostPackageNode(collapsedTop)
  if (picked) {
    const collapsedPicked = collapseLinearChains(picked)
    if (collapsedPicked.children.length) {
      topResources = [pickedPackageGroupResource(collapsedPicked, graph)]
      relations = relationsInPickedSubtree(graph, collapsedPicked)
    } else {
      topResources = [rootOnlyPackageLeafResource(collapsedPicked, graph)]
    }
  } else if (root.files.length > 0) {
    topResources = [
      rootOnlyPackageLeafResource(
        {
          fqn: ROOT_PACKAGE,
          segment: ROOT_PACKAGE,
          files: root.files,
          artefacts: root.artefacts,
          children: [],
        },
        graph,
      ),
    ]
  } else {
    topResources = []
  }

  // Doc-level description used to carry ~3 paragraphs of explainer prose that described the
  // tree-sitter-based import-resolution behaviour. That belongs in developer docs, not in the
  // per-workspace YAML — keep only a user-supplied override and/or a `Source: <path>` hint.
  const descParts: string[] = []
  if (meta.title) descParts.push(meta.title)
  if (meta.sourcePath) descParts.push(`Source: \`${meta.sourcePath}\``)

  return {
    ...(descParts.length ? { description: descParts.join('\n') } : {}),
    resources: topResources,
    perspectives: [
      {
        name: 'package imports',
        orientation: 'leftToRight',
        color: 'royalblue',
        relations,
      },
    ],
  }
}
