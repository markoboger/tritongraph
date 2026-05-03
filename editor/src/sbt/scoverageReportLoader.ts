import { scoverageReportEncodedEntries } from 'virtual:scoverage-reports'
import { ref } from 'vue'
import type { ParsedScoverageXml, ScoverageClassRate, ScoveragePackageRate } from './parseScoverageXml'

export interface LoadedScoverageReport {
  root: string
  exampleDir: string
  relPath: string
  xml: string
}

/**
 * Vite virtual module exports are not reactive by themselves. In dev, `virtual:scoverage-reports`
 * will be HMR-updated when `scoverage.xml` changes, but we still need an explicit signal so the
 * app can re-run the "apply coverage into overlay store" path.
 */
export const scoverageReportsVersion = ref(0)

let cachedEntries = (scoverageReportEncodedEntries ?? []) as any[]

if (import.meta && (import.meta as any).hot) {
  ;(import.meta as any).hot.accept('virtual:scoverage-reports', (mod: any) => {
    cachedEntries = (mod?.scoverageReportEncodedEntries ?? []) as any[]
    scoverageReportsVersion.value += 1
  })
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function getScoverageReportFor(root: string, exampleDir: string): LoadedScoverageReport | null {
  const hit = cachedEntries.find((e) => e.root === root && e.exampleDir === exampleDir)
  if (!hit) return null
  return { root: hit.root, exampleDir: hit.exampleDir, relPath: hit.relPath, xml: decodeUtf8Base64(hit.b64) }
}

export function getScoverageReportsFor(root: string, exampleDir: string): LoadedScoverageReport[] {
  return cachedEntries
    .filter((e) => e.root === root && e.exampleDir === exampleDir)
    .map((hit) => ({ root: hit.root, exampleDir: hit.exampleDir, relPath: hit.relPath, xml: decodeUtf8Base64(hit.b64) }))
}

function preferHigherWeight<T extends { statementCount?: number }>(a: T, b: T): T {
  const aw = typeof a.statementCount === 'number' && Number.isFinite(a.statementCount) ? a.statementCount : -1
  const bw = typeof b.statementCount === 'number' && Number.isFinite(b.statementCount) ? b.statementCount : -1
  return bw > aw ? b : a
}

/**
 * Merge multiple scoverage parses (multi-module builds) into one view.
 * De-dupes by `fullName` for classes and by `packageName` for packages; prefers entries with a
 * higher `statementCount` when present.
 */
export function mergeParsedScoverageXml(parses: ParsedScoverageXml[]): ParsedScoverageXml {
  const classByName = new Map<string, ScoverageClassRate>()
  const pkgByName = new Map<string, ScoveragePackageRate>()
  const docRates: number[] = []
  for (const p of parses) {
    for (const c of p.classRates ?? []) {
      const key = String(c.fullName ?? '').trim()
      if (!key) continue
      const prev = classByName.get(key)
      classByName.set(key, prev ? preferHigherWeight(prev, c) : c)
    }
    for (const pkg of p.packageRates ?? []) {
      const key = String(pkg.packageName ?? '').trim()
      if (!key) continue
      const prev = pkgByName.get(key)
      pkgByName.set(key, prev ? preferHigherWeight(prev, pkg) : pkg)
    }
    const dr = p.documentStatementRate
    if (typeof dr === 'number' && Number.isFinite(dr)) docRates.push(dr)
  }
  const documentStatementRate =
    docRates.length > 0 ? docRates.reduce((a, b) => a + b, 0) / docRates.length : undefined
  return {
    classRates: [...classByName.values()],
    packageRates: [...pkgByName.values()],
    ...(documentStatementRate != null ? { documentStatementRate } : {}),
  }
}

