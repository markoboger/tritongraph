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
  parsedTestLog?: readonly ParsedSbtSuiteBlock[]
  parsedCoverage?: ParsedScoverageXml
}

type CoverageAggregate = {
  covered: number
  total: number
  weighted: boolean
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

function buildSpecRefsByName(graph: ScalaPackageGraph): Map<string, TritonScalaSpecRef> {
  const specNameCounts = new Map<string, number>()
  const specByName = new Map<string, TritonScalaSpecRef>()
  for (const a of graph.testArtefacts ?? []) {
    if (!a?.name || !a?.file) continue
    specNameCounts.set(a.name, (specNameCounts.get(a.name) ?? 0) + 1)
    specByName.set(a.name, {
      name: a.name,
      declaration: a.declaration || `${a.kind} ${a.name}`,
      file: a.file,
      startRow: Number.isFinite(a.startRow) ? a.startRow : 0,
    })
  }
  for (const [name, count] of specNameCounts.entries()) {
    if (count !== 1) specByName.delete(name)
  }
  return specByName
}

function buildTestBlocks(
  graph: ScalaPackageGraph,
  parsedTestLog: readonly ParsedSbtSuiteBlock[],
): TritonScalaTestBlockEntry[] {
  const byName = buildArtefactSimpleNameIndex(graph)
  const out: TritonScalaTestBlockEntry[] = []
  for (const block of parsedTestLog) {
    const simple = simpleName(block.subject)
    if (!simple) continue
    const ids = byName.get(simple) ?? []
    if (ids.length !== 1) continue
    out.push({
      id: ids[0]!,
      suite: block.suite,
      subject: block.subject,
      blockText: block.blockText,
    })
  }
  return out
}

function buildSpecsByArtefact(
  graph: ScalaPackageGraph,
  parsedTestLog: readonly ParsedSbtSuiteBlock[],
): TritonSpecsByArtefactEntry[] {
  const byName = buildArtefactSimpleNameIndex(graph)
  const specByName = buildSpecRefsByName(graph)
  const specsByArtefactId = new Map<string, TritonScalaSpecRef[]>()

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
    const bucket = specsByArtefactId.get(artefactId) ?? []
    if (!bucket.some((existing) => existing.name === spec.name)) bucket.push(spec)
    specsByArtefactId.set(artefactId, bucket)
  }

  return [...specsByArtefactId.entries()]
    .map(([id, specs]) => ({ id, specs }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function buildCoverage(
  graph: ScalaPackageGraph,
  parsedCoverage: ParsedScoverageXml,
): TritonCoverageEntry[] {
  const out = new Map<string, number>()
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

  for (const [packageId, stmtPct] of packageCoverageRollups(parsedCoverage).entries()) {
    out.set(packageId, stmtPct)
  }

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

  return [...out.entries()]
    .map(([id, stmtPct]) => ({ id, stmtPct }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function buildScalaWorkspacePayload(
  options: BuildScalaWorkspacePayloadOptions,
): TritonScalaWorkspacePayload {
  const docs = collectScalaArtefactDocs(options.graph)
  const testBlocks = options.parsedTestLog ? buildTestBlocks(options.graph, options.parsedTestLog) : []
  const specsByArtefact = options.parsedTestLog
    ? buildSpecsByArtefact(options.graph, options.parsedTestLog)
    : []
  const coverage = options.parsedCoverage ? buildCoverage(options.graph, options.parsedCoverage) : []

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
