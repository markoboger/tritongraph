export interface ParsedScalaImport {
  raw: string
  prefix: string
  selectors: string[]
}

export interface ParsedScalaParent {
  name: string
  kind: 'extends' | 'with'
  typeArgs?: string
}

export interface ParsedScalaMethodSignature {
  signature: string
  startRow: number
}

export interface ParsedScalaDefinition {
  kind: string
  name: string
  startRow: number
  endRow: number
  modifiers: string[]
  parents: ParsedScalaParent[]
  paramTypeRefs: Array<{ name: string; wrapper?: string }>
  constructorParams: string
  methodSignatures: ParsedScalaMethodSignature[]
  doc: string
}

export interface ScalaFileSummary {
  packageName: string
  imports: ParsedScalaImport[]
  topLevel: ParsedScalaDefinition[]
}

export interface SourceTextFile {
  relPath: string
  source: string
}

export interface ScalaArtefact {
  kind: string
  name: string
  file: string
  startRow: number
  packageName: string
  parents: ParsedScalaParent[]
  paramTypeRefs: Array<{ name: string; wrapper?: string }>
  constructorParams: string
  modifiers: string[]
  methodSignatures: ParsedScalaMethodSignature[]
  declaration: string
  doc: string
}

export interface ScalaInheritanceEdge {
  fromArtefactId: string
  toArtefactId: string
  kind: 'extends' | 'with'
}

export interface ScalaGetsEdge {
  fromArtefactId: string
  toArtefactId: string
  kind: 'gets'
  wrapperName?: string
}

export interface ScalaPackageNode {
  name: string
  files: string[]
  artefacts: ScalaArtefact[]
}

export interface ScalaPackageEdge {
  from: string
  to: string
  weight: number
}

export interface ScalaPackageGraph {
  packages: ScalaPackageNode[]
  edges: ScalaPackageEdge[]
  inheritance: ScalaInheritanceEdge[]
  gets: ScalaGetsEdge[]
  testArtefacts: ScalaArtefact[]
}

const ARTEFACT_KINDS = new Set([
  'class',
  'case class',
  'object',
  'case object',
  'trait',
  'enum',
  'def',
])

const ROOT_PACKAGE = '<root>'

function formatArtefactDeclaration(
  modifiers: readonly string[],
  kind: string,
  name: string,
  parents: readonly ParsedScalaParent[],
): string {
  const prefix = modifiers.length ? `${modifiers.join(' ')} ` : ''
  const head = `${prefix}${kind} ${name}`
  if (!parents.length) return head
  const tail = parents.map((p) => `${p.kind} ${p.name}${p.typeArgs ?? ''}`).join(' ')
  return `${head} ${tail}`
}

function packageIsStrictAncestor(ancestor: string, maybeDesc: string): boolean {
  if (!ancestor || !maybeDesc || ancestor === ROOT_PACKAGE || ancestor === maybeDesc) return false
  return maybeDesc.startsWith(`${ancestor}.`)
}

function resolveImportToPackage(prefix: string, knownPackages: Set<string>): string | undefined {
  if (!prefix) return undefined
  if (knownPackages.has(prefix)) return prefix
  const dot = prefix.lastIndexOf('.')
  if (dot > 0) {
    const parent = prefix.slice(0, dot)
    if (knownPackages.has(parent)) return parent
  }
  return undefined
}

function artefactFromDefinition(file: SourceTextFile, pkg: string, def: ParsedScalaDefinition): ScalaArtefact {
  const modifiers = def.modifiers ?? []
  return {
    kind: def.kind,
    name: def.name,
    file: file.relPath,
    startRow: def.startRow,
    packageName: pkg,
    parents: def.parents,
    paramTypeRefs: def.paramTypeRefs ?? [],
    constructorParams: def.constructorParams ?? '',
    modifiers,
    methodSignatures: def.methodSignatures ?? [],
    declaration: formatArtefactDeclaration(modifiers, def.kind, def.name, def.parents),
    doc: def.doc ?? '',
  }
}

export function buildScalaPackageGraphFromSummaries(
  summaries: readonly { file: SourceTextFile; summary: ScalaFileSummary }[],
): ScalaPackageGraph {
  const isTestFile = (relPath: string): boolean => /(?:^|\/)src\/test\//.test(relPath)
  const mainSummaries = summaries.filter((s) => !isTestFile(s.file.relPath))
  const testSummaries = summaries.filter((s) => isTestFile(s.file.relPath))

  const byPackage = new Map<string, { files: string[]; artefacts: ScalaArtefact[] }>()
  for (const { file, summary } of mainSummaries) {
    const pkg = summary.packageName || ROOT_PACKAGE
    const bucket = byPackage.get(pkg) ?? { files: [], artefacts: [] }
    bucket.files.push(file.relPath)
    for (const def of summary.topLevel) {
      if (!ARTEFACT_KINDS.has(def.kind)) continue
      bucket.artefacts.push(artefactFromDefinition(file, pkg, def))
    }
    byPackage.set(pkg, bucket)
  }

  const knownPackages = new Set(byPackage.keys())
  const edgeCounts = new Map<string, number>()
  for (const { summary } of mainSummaries) {
    const fromPkg = summary.packageName || ROOT_PACKAGE
    for (const imp of summary.imports) {
      const target = resolveImportToPackage(imp.prefix, knownPackages)
      if (!target || target === fromPkg) continue
      if (packageIsStrictAncestor(fromPkg, target)) continue
      const key = `${fromPkg}\u0001${target}`
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
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

  const inheritance = resolveInheritanceEdges(packages, mainSummaries)
  const gets = resolveGetsEdges(packages, mainSummaries)

  const testArtefacts: ScalaArtefact[] = []
  for (const { file, summary } of testSummaries) {
    const pkg = summary.packageName || ROOT_PACKAGE
    for (const def of summary.topLevel) {
      if (!ARTEFACT_KINDS.has(def.kind)) continue
      testArtefacts.push(artefactFromDefinition(file, pkg, def))
    }
  }

  return { packages, edges, inheritance, gets, testArtefacts }
}

function resolveInheritanceEdges(
  packages: readonly ScalaPackageNode[],
  summaries: readonly { file: SourceTextFile; summary: ScalaFileSummary }[],
): ScalaInheritanceEdge[] {
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

  const out: ScalaInheritanceEdge[] = []
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

function resolveGetsEdges(
  packages: readonly ScalaPackageNode[],
  summaries: readonly { file: SourceTextFile; summary: ScalaFileSummary }[],
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
  const dotIdx = rawName.lastIndexOf('.')
  if (dotIdx > 0) {
    const explicitPkg = rawName.slice(0, dotIdx)
    const simple = rawName.slice(dotIdx + 1)
    const pkgArtefacts = artefactsInPackage(explicitPkg, ctx)
    const hit = pkgArtefacts.find((a) => a.name === simple)
    if (hit) return hit
    return undefined
  }

  const simple = rawName
  const samePkgHit = ctx.samePackageArtefacts.find((a) => a.name === simple)
  if (samePkgHit) return samePkgHit

  for (const imp of ctx.imports) {
    if (!imp.selectors.includes('_')) continue
    const pkgArtefacts = artefactsInPackage(imp.prefix, ctx)
    const hit = pkgArtefacts.find((a) => a.name === simple)
    if (hit) return hit
  }

  for (const imp of ctx.imports) {
    if (!imp.selectors.includes(simple)) continue
    const pkgArtefacts = artefactsInPackage(imp.prefix, ctx)
    const hit = pkgArtefacts.find((a) => a.name === simple)
    if (hit) return hit
  }

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

export function artefactResourceId(packageFqn: string, art: ScalaArtefact): string {
  const safeKind = art.kind.replace(/\s+/g, '-')
  const root = packageFqn || ROOT_PACKAGE
  return `${root}::${safeKind}:${art.name}`
}

export function collectScalaArtefactDocs(
  graph: ScalaPackageGraph,
): Array<{ id: string; doc: string }> {
  const out: Array<{ id: string; doc: string }> = []
  for (const pkg of graph.packages) {
    for (const a of pkg.artefacts) {
      if (!a.doc) continue
      out.push({ id: artefactResourceId(a.packageName, a), doc: a.doc })
    }
  }
  return out
}
