import type {
  IlographDocument,
  IlographRelation,
  IlographResource,
  TritonInnerArtefactSpec,
  TritonInnerPackageSpec,
} from '../ilograph/types'
import {
  summarizeScala,
  type ParsedScalaParent,
  type ScalaFileSummary,
} from './parseScalaWithTreeSitter'
import type { LoadedScalaFile } from './scalaSourceLoader'

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
  /** Fully-qualified package the artefact lives in (`com.example.animalsfruit.animal`). */
  packageName: string
  /** `extends X with Y with Z` parents in source order; empty for top-level defs / vals etc. */
  parents: ParsedScalaParent[]
}

export interface ScalaInheritanceEdge {
  /** Parent (more abstract) artefact id — laid out to the LEFT (lower depth). */
  fromArtefactId: string
  /** Child (more concrete) artefact id — laid out to the RIGHT (higher depth). */
  toArtefactId: string
  /** `extends` for the primary parent of the child; `with` for stacked traits. */
  kind: 'extends' | 'with'
}

export interface ScalaPackageNode {
  /** Fully-qualified package name (`com.example.core`). Files without a package land in `<root>`. */
  name: string
  /** Files belonging to this package (path relative to project root). */
  files: string[]
  /** Top-level Scala artefacts (classes / objects / traits / enums / top-level defs etc.). */
  artefacts: ScalaArtefact[]
}

/**
 * Kinds we render as their own `ScalaArtefactBox`. Top-level `val` / `var` / `type` / `given`
 * are intentionally omitted: they are rarely declared directly under a `package` clause and would
 * mostly add visual noise next to the type / object boxes that anchor the package's API.
 */
const ARTEFACT_KINDS = new Set([
  'class',
  'case class',
  'object',
  'case object',
  'trait',
  'enum',
  'def',
])

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
}

const ROOT_PACKAGE = '<root>'

/** True when `ancestor` is a strict prefix of `maybeDesc` as package FQNs (`a.b` ancestor of `a.b.c`). */
function packageIsStrictAncestor(ancestor: string, maybeDesc: string): boolean {
  if (!ancestor || !maybeDesc || ancestor === ROOT_PACKAGE || ancestor === maybeDesc) return false
  return maybeDesc.startsWith(`${ancestor}.`)
}

/** Best-effort: decide whether an `import foo.bar.X` targets a package we know about. */
function resolveImportToPackage(prefix: string, knownPackages: Set<string>): string | undefined {
  if (!prefix) return undefined
  if (knownPackages.has(prefix)) return prefix
  // `import com.example.core.Domain` (Domain is a class, not a package) — try the parent.
  const dot = prefix.lastIndexOf('.')
  if (dot > 0) {
    const parent = prefix.slice(0, dot)
    if (knownPackages.has(parent)) return parent
  }
  return undefined
}

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

  // Group by package name.
  const byPackage = new Map<string, { files: string[]; artefacts: ScalaArtefact[] }>()
  for (const { file, summary } of summaries) {
    const pkg = summary.packageName || ROOT_PACKAGE
    const bucket = byPackage.get(pkg) ?? { files: [], artefacts: [] }
    bucket.files.push(file.relPath)
    for (const def of summary.topLevel) {
      if (!ARTEFACT_KINDS.has(def.kind)) continue
      bucket.artefacts.push({
        kind: def.kind,
        name: def.name,
        file: file.relPath,
        packageName: pkg,
        parents: def.parents,
      })
    }
    byPackage.set(pkg, bucket)
  }

  const knownPackages = new Set(byPackage.keys())

  /**
   * Package → package edges from imports whose **prefix** resolves to a known package FQN:
   * `import p._`, `import p.{T, U}`, and `import p.T` (see {@link resolveImportToPackage}).
   * Skip parent → descendant (`from` strict ancestor of `to`): the parent already *contains* the
   * child; that access is containment, not an `imports` layering edge between nested packages.
   */
  const edgeCounts = new Map<string, number>()
  for (const { file, summary } of summaries) {
    const fromPkg = summary.packageName || ROOT_PACKAGE
    for (const imp of summary.imports) {
      const target = resolveImportToPackage(imp.prefix, knownPackages)
      if (!target || target === fromPkg) continue
      if (packageIsStrictAncestor(fromPkg, target)) continue
      const key = `${fromPkg}\u0001${target}`
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
      void file
    }
  }

  const packages: ScalaPackageNode[] = [...byPackage.entries()]
    .map(([name, b]) => ({
      name,
      files: dedupeSortedStrings(b.files),
      artefacts: dedupeArtefacts(b.artefacts),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const edges: ScalaPackageEdge[] = [...edgeCounts.entries()]
    .map(([key, weight]) => {
      const [from, to] = key.split('\u0001') as [string, string]
      return { from, to, weight }
    })
    .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)))

  const inheritance = resolveInheritanceEdges(packages, summaries)

  return { packages, edges, inheritance }
}

/**
 * Walk every artefact's `extends … with …` parent list and resolve each parent name to a known
 * artefact id. Resolution priority (first hit wins, mirroring how the Scala compiler resolves
 * unqualified type references in practice):
 *
 *   1. Same package as the child (most common — siblings in `Animal.scala` extend each other).
 *   2. Wildcard imports in the child's file (`import com.example.fruit._`) — promote any artefact
 *      defined in the imported package.
 *   3. Explicit single-name imports in the child's file (`import com.example.fruit.Apple`).
 *   4. Globally unique simple name across the entire project.
 *
 * Anything still unresolved is dropped: it's almost always a stdlib type (`Set`, `String`, `Any`,
 * `Throwable`, …) or a third-party library type that doesn't belong on the artefact diagram.
 */
function resolveInheritanceEdges(
  packages: readonly ScalaPackageNode[],
  summaries: readonly { file: LoadedScalaFile; summary: ScalaFileSummary }[],
): ScalaInheritanceEdge[] {
  /** Index every artefact by its FQN-with-kind id (computed identically to `artefactResourceId`). */
  const artefactById = new Map<string, ScalaArtefact>()
  /** simple name → list of artefacts with that name (across all packages). For globally-unique fallback. */
  const bySimpleName = new Map<string, ScalaArtefact[]>()
  /** package fqn → artefacts in that package. For same-package and import-as-wildcard resolution. */
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
  /** file relPath → ScalaFileSummary; we need the per-file `imports` to resolve type names. */
  const summaryByFile = new Map<string, ScalaFileSummary>()
  for (const s of summaries) summaryByFile.set(s.file.relPath, s.summary)

  const out: ScalaInheritanceEdge[] = []
  /** De-dupe in case a type appears multiple times in the same parent list (shouldn't, but keep edges unique). */
  const seen = new Set<string>()
  for (const p of packages) {
    const samePackageArtefacts = byPackage.get(p.name) ?? []
    for (const child of p.artefacts) {
      const childId = artefactResourceId(child.packageName, child)
      const summary = summaryByFile.get(child.file)
      const imports = summary?.imports ?? []
      for (const parent of child.parents) {
        const parentArt = resolveParentName(parent.name, {
          samePackageArtefacts,
          imports,
          bySimpleName,
          artefactById,
        })
        if (!parentArt) continue
        const parentId = artefactResourceId(parentArt.packageName, parentArt)
        if (parentId === childId) continue
        const key = `${parentId}\u0001${childId}\u0001${parent.kind}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ fromArtefactId: parentId, toArtefactId: childId, kind: parent.kind })
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
    }))
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
function rootOnlyPackageLeafResource(node: PackageTreeNode): IlographResource {
  const files = collectSubtreeFiles(node)
  const name = node.segment || node.fqn || ROOT_PACKAGE
  const lines: string[] = []
  lines.push(`Package: \`${node.fqn || ROOT_PACKAGE}\``)
  if (files.length) {
    lines.push('')
    lines.push(`Files (${files.length}):`)
    for (const f of files) lines.push(`  - ${f}`)
  }
  const inner = rootInnerPackageSpecs(node)
  const innerArts = innerArtefactSpecsForNode(node)
  return {
    id: node.fqn || ROOT_PACKAGE,
    name,
    subtitle: `${files.length} Scala file${files.length === 1 ? '' : 's'}`,
    description: lines.join('\n'),
    ...(inner.length ? { 'x-triton-inner-packages': inner } : {}),
    ...(innerArts.length ? { 'x-triton-inner-artefacts': innerArts } : {}),
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
function flattenDescendantPackageResources(picked: PackageTreeNode): IlographResource[] {
  const out: IlographResource[] = []
  function visit(n: PackageTreeNode) {
    const c = collapseLinearChains(n)
    for (const ch of c.children) {
      const cc = collapseLinearChains(ch)
      out.push(packageLeafResourceForGraph(cc))
      visit(ch)
    }
  }
  visit(picked)
  out.sort((a, b) => String(a.id ?? a.name).localeCompare(String(b.id ?? b.name)))
  return out
}

function packageLeafResourceForGraph(n: PackageTreeNode): IlographResource {
  const c = collapseLinearChains(n)
  const files = collectSubtreeFiles(c)
  const lines: string[] = []
  lines.push(`Package: \`${c.fqn}\``)
  if (files.length) {
    lines.push('')
    lines.push(`Files (${files.length}):`)
    for (const f of files) lines.push(`  - ${f}`)
  }
  const innerArts = innerArtefactSpecsForNode(c)
  return {
    id: c.fqn,
    name: c.segment || c.fqn,
    subtitle: `${files.length} Scala file${files.length === 1 ? '' : 's'}`,
    description: lines.join('\n'),
    'x-triton-node-type': 'package',
    ...(innerArts.length ? { 'x-triton-inner-artefacts': innerArts } : {}),
  }
}

/**
 * Outer picked scope as a **group** (`x-triton-package-scope`): package-style chrome in
 * {@link GroupNode}. All descendant packages are **flat** child resources for dependency layout.
 */
function pickedPackageGroupResource(picked: PackageTreeNode): IlographResource {
  const top = collapseLinearChains(picked)
  const files = collectSubtreeFiles(top)
  const name = top.segment || top.fqn || ROOT_PACKAGE
  const childResources = flattenDescendantPackageResources(top)
  const lines: string[] = []
  lines.push(`Package scope: \`${top.fqn}\``)
  if (files.length) {
    lines.push('')
    lines.push(`Files (${files.length}):`)
    for (const f of files) lines.push(`  - ${f}`)
  }
  return {
    id: top.fqn,
    name,
    subtitle: `${files.length} Scala file${files.length === 1 ? '' : 's'} · ${childResources.length} nested packages (flat graph)`,
    description: lines.join('\n'),
    'x-triton-package-scope': true,
    children: childResources,
  }
}

/** All `imports` edges whose endpoints lie in the picked subtree (any depth). */
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
      topResources = [pickedPackageGroupResource(collapsedPicked)]
      relations = relationsInPickedSubtree(graph, collapsedPicked)
    } else {
      topResources = [rootOnlyPackageLeafResource(collapsedPicked)]
    }
  } else if (root.files.length > 0) {
    topResources = [
      rootOnlyPackageLeafResource({
        fqn: ROOT_PACKAGE,
        segment: ROOT_PACKAGE,
        files: root.files,
        artefacts: root.artefacts,
        children: [],
      }),
    ]
  } else {
    topResources = []
  }

  const descParts = [
    meta.title ??
      'Scala package (tree-sitter): outer scope as a group; direct sub-packages as nodes laid out by `imports` edges from import statements.',
    'Parent → descendant package imports are omitted (containment). Imports of packages not in this graph produce no edge. Artefacts are not separate nodes here.',
  ]
  if (meta.sourcePath) descParts.push(`Source: \`${meta.sourcePath}\``)

  const perspectiveNotes =
    relations.length > 0
      ? 'Edges: `imports` from `import …` when the import prefix resolves to another package in this scope (classpath-style LR columns).'
      : 'No package-level import edges among direct sub-packages of the picked scope.'

  return {
    description: descParts.join('\n'),
    resources: topResources,
    perspectives: [
      {
        name: 'package imports',
        orientation: 'leftToRight',
        color: 'royalblue',
        notes: perspectiveNotes,
        relations,
      },
    ],
  }
}
