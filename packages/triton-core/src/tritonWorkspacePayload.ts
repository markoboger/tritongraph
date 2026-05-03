import type { IlographDocument } from './ilographTypes'
import type { ParsedSbtSuiteBlock } from './parseSbtTestLog'
import type { ParsedScoverageXml } from './parseScoverageXml'
import {
  artefactResourceId,
  collectScalaArtefactDocs,
  type ScalaPackageGraph,
} from './scalaPackageGraph'

export interface TritonScalaSpecRef {
  name: string
  declaration: string
  file: string
  startRow: number
}

export interface TritonScalaTestBlockEntry {
  id: string
  suite: string
  subject: string
  blockText: string
}

export interface TritonCoverageEntry {
  id: string
  stmtPct: number
}

export interface TritonSpecsByArtefactEntry {
  id: string
  specs: TritonScalaSpecRef[]
}

export interface TritonScalaWorkspacePayload {
  kind: 'scala-workspace'
  sourcePath: string
  title?: string
  graph: ScalaPackageGraph
  ilographDocument?: IlographDocument
  docs: Array<{ id: string; doc: string }>
  testBlocks: TritonScalaTestBlockEntry[]
  coverage: TritonCoverageEntry[]
  specsByArtefact: TritonSpecsByArtefactEntry[]
}

interface BuildScalaWorkspacePayloadOptions {
  sourcePath: string
  graph: ScalaPackageGraph
  title?: string
  ilographDocument?: IlographDocument
  /**
   * Optional sbt project list document used only for coverage attribution (base dirs → project ids).
   * The packages diagram document usually lacks `x-triton-project-compartments`; pass the same
   * document shape as `sbtProjectsToIlographDocument` here when loading a packages tab.
   */
  coverageProjectDocument?: IlographDocument
  parsedTestLog?: readonly ParsedSbtSuiteBlock[]
  parsedCoverage?: ParsedScoverageXml
}

type CoverageAggregate = {
  covered: number
  total: number
  weighted: boolean
}

function meanFinite(values: readonly number[]): number | undefined {
  const xs = values.filter((x) => typeof x === 'number' && Number.isFinite(x))
  if (!xs.length) return undefined
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

type ProjectCoverageMeta = {
  id: string
  baseDir: string
  kind: 'project' | 'module'
}

function packageAncestorsInclusive(packageName: string): string[] {
  const trimmed = String(packageName ?? '').trim()
  if (!trimmed || trimmed === '<root>') return ['<root>']
  const parts = trimmed.split('.').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join('.'))
  return out
}

function addCoverageAggregate(
  map: Map<string, CoverageAggregate>,
  packageName: string,
  statementRate: number,
  statementCount?: number,
): void {
  const hasWeight = typeof statementCount === 'number' && Number.isFinite(statementCount) && statementCount > 0
  for (const ancestor of packageAncestorsInclusive(packageName)) {
    const cur = map.get(ancestor) ?? { covered: 0, total: 0, weighted: false }
    if (hasWeight) {
      cur.covered += statementRate * statementCount
      cur.total += statementCount
      cur.weighted = true
    } else if (!cur.weighted) {
      cur.covered += statementRate
      cur.total += 1
    }
    map.set(ancestor, cur)
  }
}

function packageCoverageRollups(parsed: ParsedScoverageXml): Map<string, number> {
  const out = new Map<string, number>()
  const aggregates = new Map<string, CoverageAggregate>()
  const baseRates = parsed.classRates.length ? parsed.classRates : parsed.packageRates
  for (const entry of baseRates) {
    addCoverageAggregate(aggregates, entry.packageName, entry.statementRate, entry.statementCount)
  }
  for (const [packageName, agg] of aggregates.entries()) {
    if (!(agg.total > 0)) continue
    out.set(packageName, agg.covered / agg.total)
  }
  for (const pkg of parsed.packageRates) out.set(pkg.packageName, pkg.statementRate)
  return out
}

function projectCoverageMetas(doc?: IlographDocument): ProjectCoverageMeta[] {
  const resources = doc?.resources ?? []
  const out: ProjectCoverageMeta[] = []
  for (const res of resources) {
    const compartments = res['x-triton-project-compartments'] ?? []
    const settings = compartments.find((c) => c.id === 'settings')
    const baseDir =
      settings?.rows.find((row) => (row.label ?? '').toLowerCase() === 'base dir')?.value?.trim() ?? ''
    out.push({
      id: String(res.name ?? ''),
      baseDir: baseDir || '.',
      kind: res['x-triton-project-kind'] === 'project' ? 'project' : 'module',
    })
  }
  return out.filter((x) => x.id)
}

function normalizeProjectBaseDir(baseDir: string): string {
  const cleaned = String(baseDir ?? '').trim().replace(/^\.\/+/, '').replace(/\/+$/, '')
  return cleaned || '.'
}

function projectIdForFile(relPath: string, projects: readonly ProjectCoverageMeta[]): string | undefined {
  const normalized = String(relPath ?? '').replace(/^\.\/+/, '')
  let best: ProjectCoverageMeta | undefined
  for (const project of projects) {
    const baseDir = normalizeProjectBaseDir(project.baseDir)
    const match =
      baseDir === '.' ? true : normalized === baseDir || normalized.startsWith(`${baseDir}/`)
    if (!match) continue
    if (!best || normalizeProjectBaseDir(best.baseDir).length < baseDir.length) best = project
  }
  return best?.id
}

function addProjectCoverageFromPackages(
  out: Map<string, number>,
  graph: ScalaPackageGraph,
  parsedCoverage: ParsedScoverageXml,
  doc?: IlographDocument,
): void {
  const projects = projectCoverageMetas(doc)
  if (!projects.length) return

  const packageRates = packageCoverageRollups(parsedCoverage)
  const packageCounts = new Map(parsedCoverage.packageRates.map((r) => [r.packageName, r.statementCount ?? 0]))
  const aggregates = new Map<string, CoverageAggregate>()

  for (const pkg of graph.packages) {
    const pkgRate = packageRates.get(pkg.name)
    if (pkgRate == null) continue
    const owners = new Set(pkg.files.map((file) => projectIdForFile(file, projects)).filter(Boolean) as string[])
    if (!owners.size) continue
    const statementCount = packageCounts.get(pkg.name)
    const hasWeight =
      typeof statementCount === 'number' && Number.isFinite(statementCount) && statementCount > 0
    const fallbackWeight = Math.max(1, pkg.files.length)
    for (const projectId of owners) {
      const cur = aggregates.get(projectId) ?? { covered: 0, total: 0, weighted: false }
      if (hasWeight) {
        cur.covered += pkgRate * statementCount
        cur.total += statementCount
        cur.weighted = true
      } else if (!cur.weighted) {
        cur.covered += pkgRate * fallbackWeight
        cur.total += fallbackWeight
      }
      aggregates.set(projectId, cur)
    }
  }

  for (const [projectId, agg] of aggregates.entries()) {
    if (!(agg.total > 0)) continue
    out.set(projectId, agg.covered / agg.total)
  }

  const overall = { covered: 0, total: 0 }
  for (const pkg of graph.packages) {
    const pkgRate = packageRates.get(pkg.name)
    if (pkgRate == null) continue
    const statementCount = packageCounts.get(pkg.name)
    const weight =
      typeof statementCount === 'number' && Number.isFinite(statementCount) && statementCount > 0
        ? statementCount
        : Math.max(1, pkg.files.length)
    overall.covered += pkgRate * weight
    overall.total += weight
  }
  const overallRate = overall.total > 0 ? overall.covered / overall.total : undefined
  if (overallRate == null) return

  const rootProjects = projects.filter((project) => project.kind === 'project')
  if (rootProjects.length) {
    for (const project of rootProjects) out.set(project.id, overallRate)
  }
  for (const project of projects) {
    if (!out.has(project.id)) out.set(project.id, overallRate)
  }
}

function buildArtefactSimpleNameIndex(
  graph: ScalaPackageGraph,
): Map<string, string[]> {
  const byName = new Map<string, string[]>()
  for (const p of graph.packages) {
    for (const a of p.artefacts) {
      const id = artefactResourceId(a.packageName, a)
      const bucket = byName.get(a.name) ?? []
      bucket.push(id)
      byName.set(a.name, bucket)
    }
  }
  return byName
}

function simpleName(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  return text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text
}

function specRefFromArtefact(a: { name: string; declaration: string; file: string; startRow: number; kind: string }): TritonScalaSpecRef {
  return {
    name: a.name,
    declaration: a.declaration || `${a.kind} ${a.name}`,
    file: a.file,
    startRow: Number.isFinite(a.startRow) ? a.startRow : 0,
  }
}

function buildSpecRefsByName(graph: ScalaPackageGraph): Map<string, TritonScalaSpecRef> {
  const specNameCounts = new Map<string, number>()
  const specByName = new Map<string, TritonScalaSpecRef>()
  for (const a of graph.testArtefacts ?? []) {
    if (!a?.name || !a?.file) continue
    specNameCounts.set(a.name, (specNameCounts.get(a.name) ?? 0) + 1)
    specByName.set(a.name, specRefFromArtefact(a))
  }
  for (const [name, count] of specNameCounts.entries()) {
    if (count !== 1) specByName.delete(name)
  }
  return specByName
}

function addSpecRef(
  specsByArtefactId: Map<string, TritonScalaSpecRef[]>,
  artefactId: string,
  spec: TritonScalaSpecRef,
): void {
  const bucket = specsByArtefactId.get(artefactId) ?? []
  if (!bucket.some((existing) => existing.name === spec.name && existing.file === spec.file)) bucket.push(spec)
  specsByArtefactId.set(artefactId, bucket)
}

function suiteName(raw: string): string {
  return String(raw ?? '').trim().replace(/:$/, '')
}

function suiteTargetNameCandidates(rawSuite: string): string[] {
  const raw = simpleName(suiteName(rawSuite))
  if (!raw) return []
  const out = [raw]
  if (raw.endsWith('Spec')) out.push(raw.slice(0, -'Spec'.length))
  for (const suffix of ['ModelSpec', 'RoutesSpec', 'ParserSpec', 'RepositorySpec', 'ServiceSpec']) {
    if (raw.endsWith(suffix)) out.push(raw.slice(0, -suffix.length))
  }
  return [...new Set(out.filter(Boolean))]
}

function testLogHeadingTargetNameCandidates(block: ParsedSbtSuiteBlock): string[] {
  const out: string[] = []
  for (const line of block.lines ?? []) {
    const text = String(line ?? '').trim()
    if (!text || text.endsWith('Spec:') || text.startsWith('- ')) continue
    const m = /^([A-Z]\w*)\b/.exec(text)
    if (m?.[1]) out.push(m[1])
  }
  return [...new Set(out)]
}

function addUniqueBlock(
  blocksByArtefactId: Map<string, TritonScalaTestBlockEntry[]>,
  artefactId: string,
  block: TritonScalaTestBlockEntry,
): void {
  const bucket = blocksByArtefactId.get(artefactId) ?? []
  if (!bucket.some((existing) => existing.suite === block.suite && existing.blockText === block.blockText)) {
    bucket.push(block)
  }
  blocksByArtefactId.set(artefactId, bucket)
}

function caseClassConstructionIdsBySpecName(graph: ScalaPackageGraph): Map<string, string[]> {
  const bySimpleName = new Map<string, Array<{ id: string; packageName: string }>>()
  const byPackageAndName = new Map<string, string>()

  for (const p of graph.packages) {
    for (const a of p.artefacts) {
      if (a.kind !== 'case class') continue
      const id = artefactResourceId(a.packageName, a)
      const simpleBucket = bySimpleName.get(a.name) ?? []
      simpleBucket.push({ id, packageName: a.packageName })
      bySimpleName.set(a.name, simpleBucket)
      byPackageAndName.set(`${a.packageName}\u0001${a.name}`, id)
    }
  }

  const out = new Map<string, string[]>()
  for (const specArt of graph.testArtefacts ?? []) {
    if (!specArt?.name || !specArt.file || !specArt.createdTypeRefs.length) continue
    const ids = new Set<string>()
    for (const rawRef of specArt.createdTypeRefs) {
      const ref = String(rawRef ?? '').trim()
      if (!ref) continue
      const simple = simpleName(ref)
      if (!simple) continue

      const explicitPackage = ref.includes('.') ? ref.slice(0, ref.lastIndexOf('.')) : ''
      const explicitHit = explicitPackage ? byPackageAndName.get(`${explicitPackage}\u0001${simple}`) : undefined
      if (explicitHit) {
        ids.add(explicitHit)
        continue
      }

      const candidates = bySimpleName.get(simple) ?? []
      const samePackageHit = candidates.find((c) => c.packageName === specArt.packageName)
      if (samePackageHit) {
        ids.add(samePackageHit.id)
        continue
      }
      if (candidates.length === 1) ids.add(candidates[0]!.id)
    }
    if (ids.size) out.set(specArt.name, [...ids])
  }
  return out
}

function buildTestBlocks(
  graph: ScalaPackageGraph,
  parsedTestLog: readonly ParsedSbtSuiteBlock[],
): TritonScalaTestBlockEntry[] {
  const byName = buildArtefactSimpleNameIndex(graph)
  const constructedCaseClassIds = caseClassConstructionIdsBySpecName(graph)
  const blocksByArtefactId = new Map<string, TritonScalaTestBlockEntry[]>()
  for (const block of parsedTestLog) {
    const entry = {
      id: '',
      suite: block.suite,
      subject: block.subject,
      blockText: block.blockText,
    }
    const targetIds = new Set<string>()
    for (const name of [
      simpleName(block.subject),
      ...testLogHeadingTargetNameCandidates(block),
      ...suiteTargetNameCandidates(block.suite),
    ]) {
      const ids = byName.get(name) ?? []
      if (ids.length === 1) targetIds.add(ids[0]!)
    }

    const specConstructedIds = constructedCaseClassIds.get(suiteName(block.suite))
    for (const id of specConstructedIds ?? []) targetIds.add(id)

    for (const id of targetIds) addUniqueBlock(blocksByArtefactId, id, { ...entry, id })
  }
  return [...blocksByArtefactId.entries()]
    .map(([id, blocks]) => ({
      id,
      suite: blocks.length === 1 ? blocks[0]!.suite : `${blocks.length} test suites`,
      subject: blocks.length === 1 ? blocks[0]!.subject : '',
      blockText: blocks.map((b) => b.blockText).join('\n\n'),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function buildCaseClassConstructionSpecs(graph: ScalaPackageGraph): Map<string, TritonScalaSpecRef[]> {
  const idsBySpecName = caseClassConstructionIdsBySpecName(graph)
  const out = new Map<string, TritonScalaSpecRef[]>()
  for (const specArt of graph.testArtefacts ?? []) {
    if (!specArt?.name || !specArt.file) continue
    const spec = specRefFromArtefact(specArt)
    for (const id of idsBySpecName.get(specArt.name) ?? []) addSpecRef(out, id, spec)
  }
  return out
}

function buildSpecsByArtefact(
  graph: ScalaPackageGraph,
  parsedTestLog: readonly ParsedSbtSuiteBlock[],
): TritonSpecsByArtefactEntry[] {
  const byName = buildArtefactSimpleNameIndex(graph)
  const specByName = buildSpecRefsByName(graph)
  const specsByArtefactId = buildCaseClassConstructionSpecs(graph)

  for (const block of parsedTestLog) {
    const rawSubject = String(block.subject ?? '').trim()
    if (!rawSubject) continue
    const ids = byName.get(simpleName(rawSubject)) ?? []
    if (ids.length !== 1) continue
    const artefactId = ids[0]!
    const suiteLine = String(block.suite ?? '').trim()
    if (!suiteLine) continue
    const suiteName = suiteLine.endsWith(':') ? suiteLine.slice(0, -1) : suiteLine
    const spec = specByName.get(suiteName)
    if (!spec) continue
    addSpecRef(specsByArtefactId, artefactId, spec)
  }

  return [...specsByArtefactId.entries()]
    .map(([id, specs]) => ({ id, specs }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function buildCoverage(
  graph: ScalaPackageGraph,
  parsedCoverage: ParsedScoverageXml,
  ilographDocument?: IlographDocument,
  coverageProjectDocument?: IlographDocument,
): TritonCoverageEntry[] {
  const out = new Map<string, number>()
  const packageRollups = packageCoverageRollups(parsedCoverage)
  const idx = new Map<string, { classIds: string[]; objectIds: string[]; traitIds: string[] }>()

  for (const p of graph.packages) {
    for (const a of p.artefacts) {
      const id = artefactResourceId(a.packageName, a)
      const key = `${a.packageName || '<root>'}\u0001${a.name}`
      const bucket = idx.get(key) ?? { classIds: [], objectIds: [], traitIds: [] }
      const kind = a.kind.toLowerCase()
      if (kind.includes('trait')) bucket.traitIds.push(id)
      else if (kind.includes('object')) bucket.objectIds.push(id)
      else if (kind.includes('class')) bucket.classIds.push(id)
      idx.set(key, bucket)
    }
  }

  for (const [packageId, stmtPct] of packageRollups.entries()) {
    out.set(packageId, stmtPct)
  }

  addProjectCoverageFromPackages(
    out,
    graph,
    parsedCoverage,
    coverageProjectDocument ?? ilographDocument,
  )

  for (const rate of parsedCoverage.classRates) {
    const dot = rate.fullName.lastIndexOf('.')
    const pkg = dot <= 0 ? '<root>' : rate.fullName.slice(0, dot)
    const rawSimple = dot <= 0 ? rate.fullName : rate.fullName.slice(dot + 1)
    const simpleCandidates = Array.from(
      new Set([
        rawSimple,
        rawSimple.endsWith('$') ? rawSimple.slice(0, -1) : rawSimple,
        rawSimple.includes('$') ? rawSimple.slice(0, rawSimple.indexOf('$')) : rawSimple,
      ].filter(Boolean)),
    )

    let hit: { classIds: string[]; objectIds: string[]; traitIds: string[] } | undefined
    for (const simple of simpleCandidates) {
      hit = idx.get(`${pkg}\u0001${simple}`)
      if (hit) break
    }
    if (!hit) continue

    const type = (rate.classType || '').toLowerCase()
    const candidates = type === 'object' ? hit.objectIds : type === 'trait' ? hit.traitIds : hit.classIds
    for (const id of candidates) out.set(id, rate.statementRate)
  }

  /**
   * Some artefacts never appear as individual `<class>` rows in scoverage even though their
   * package has coverage and they have associated specs/test output. Tiny wrapper/base classes
   * like `Vertebrate` in the tutorial example are a common case. Rather than showing no coverage
   * icon at all, fall back to the enclosing package's aggregated statement rate.
   */
  for (const p of graph.packages) {
    const pkgRate = packageRollups.get(p.name)
    if (pkgRate == null) continue
    for (const a of p.artefacts) {
      const id = artefactResourceId(a.packageName, a)
      if (out.has(id)) continue
      out.set(id, pkgRate)
    }
  }

  const projectDoc = coverageProjectDocument ?? ilographDocument
  const metas = projectCoverageMetas(projectDoc)
  const rollupValues = [...packageRollups.values()]
  const fallback =
    parsedCoverage.documentStatementRate ??
    meanFinite(parsedCoverage.packageRates.map((r) => r.statementRate)) ??
    meanFinite(rollupValues)
  if (fallback != null && metas.length) {
    for (const m of metas) {
      if (!out.has(m.id)) out.set(m.id, fallback)
    }
  }

  /**
   * When XML only exposes an aggregate rate, package names disagree with the scanner, or reports
   * omit per-package summaries, project-level fallbacks alone leave every package/artefact node
   * without overlay rows — so the UI shows no coverage dots at all.
   */
  if (fallback != null) {
    for (const p of graph.packages) {
      if (!out.has(p.name)) out.set(p.name, fallback)
      for (const a of p.artefacts) {
        const id = artefactResourceId(a.packageName, a)
        if (!out.has(id)) out.set(id, fallback)
      }
    }
  }

  return [...out.entries()]
    .map(([id, stmtPct]) => ({ id, stmtPct }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function buildScalaWorkspacePayload(
  options: BuildScalaWorkspacePayloadOptions,
): TritonScalaWorkspacePayload {
  const docs = collectScalaArtefactDocs(options.graph)
  const testBlocks = options.parsedTestLog ? buildTestBlocks(options.graph, options.parsedTestLog) : []
  const specsByArtefact = buildSpecsByArtefact(options.graph, options.parsedTestLog ?? [])
  const coverage = options.parsedCoverage
    ? buildCoverage(
        options.graph,
        options.parsedCoverage,
        options.ilographDocument,
        options.coverageProjectDocument,
      )
    : []

  return {
    kind: 'scala-workspace',
    sourcePath: options.sourcePath,
    ...(options.title ? { title: options.title } : {}),
    ...(options.ilographDocument ? { ilographDocument: options.ilographDocument } : {}),
    graph: options.graph,
    docs,
    testBlocks,
    coverage,
    specsByArtefact,
  }
}
