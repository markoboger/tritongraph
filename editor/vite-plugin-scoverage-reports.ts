import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const RESOLVED = 'virtual:scoverage-reports'
const VIRTUAL_ID = '\0' + RESOLVED

export interface ExampleRoot {
  name: string
  dir: string
}

interface CoverageEntry {
  root: string
  exampleDir: string
  relPath: string
  b64: string
}

const IGNORED_DIRS = new Set([
  '.git',
  '.idea',
  '.bloop',
  '.metals',
  '.scala-build',
  'node_modules',
  'dist',
  'out',
])

/**
 * Multi-module sbt builds often generate per-subproject reports:
 *   <example>/<subproject>/target/scala-<binary>/scoverage-report/scoverage.xml
 * not just `<example>/target/...`. Scan a few levels deep and pick the newest report.
 */
function findScoverageXmls(exampleRoot: string): Array<{ absPath: string; relPath: string }> {
  const candidates: string[] = []

  // BFS walk (depth-limited) to find "target/scala-*/scoverage-report/scoverage.xml"
  const q: Array<{ dir: string; depth: number }> = [{ dir: exampleRoot, depth: 0 }]
  const maxDepth = 3
  while (q.length) {
    const { dir, depth } = q.shift()!
    if (depth > maxDepth) continue
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (IGNORED_DIRS.has(ent.name)) continue
      const abs = path.join(dir, ent.name)
      if (ent.name === 'target') {
        let scalaDirs: string[] = []
        try {
          scalaDirs = fs
            .readdirSync(abs, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith('scala-'))
            .map((d) => d.name)
        } catch {
          scalaDirs = []
        }
        for (const sd of scalaDirs) {
          candidates.push(path.join(abs, sd, 'scoverage-report', 'scoverage.xml'))
        }
        continue
      }
      q.push({ dir: abs, depth: depth + 1 })
    }
  }

  const out: Array<{ absPath: string; relPath: string }> = []
  for (const absPath of candidates) {
    try {
      const st = fs.statSync(absPath)
      if (!st.isFile()) continue
    } catch {
      continue
    }
    const relPath = path.relative(exampleRoot, absPath).split(path.sep).join('/')
    out.push({ absPath, relPath })
  }
  // Stable order in module output to minimize churn; newest-first so callers can prefer the freshest.
  out.sort((a, b) => {
    try {
      const am = fs.statSync(a.absPath).mtimeMs
      const bm = fs.statSync(b.absPath).mtimeMs
      if (am !== bm) return bm - am
    } catch {
      // ignore
    }
    return a.relPath.localeCompare(b.relPath)
  })
  return out
}

/**
 * Bundle `scoverage.xml` reports generated under example `target/` directories.
 *
 * We only include the XML summary, not the HTML assets, since the editor needs percentages
 * per artefact, not the full report UI.
 */
export function scoverageReportsVirtualModule(roots: ExampleRoot[]): Plugin {
  return {
    name: 'virtual:scoverage-reports',
    enforce: 'pre',
    resolveId(id) {
      if (id === RESOLVED || id.startsWith(`${RESOLVED}?`)) return VIRTUAL_ID
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      const entries: CoverageEntry[] = []
      for (const r of roots) {
        if (!fs.existsSync(r.dir)) continue
        for (const ent of fs.readdirSync(r.dir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue
          const exampleRoot = path.join(r.dir, ent.name)
          const hits = findScoverageXmls(exampleRoot)
          if (!hits.length) continue
          for (const hit of hits) {
            this.addWatchFile(hit.absPath)
            const source = fs.readFileSync(hit.absPath, 'utf8')
            const b64 = Buffer.from(source, 'utf8').toString('base64')
            entries.push({ root: r.name, exampleDir: ent.name, relPath: hit.relPath, b64 })
          }
        }
      }
      entries.sort((a, b) => {
        if (a.root !== b.root) return a.root.localeCompare(b.root)
        return a.exampleDir.localeCompare(b.exampleDir)
      })
      const body = entries.map((e) => JSON.stringify(e)).join(',\n')
      return `export const scoverageReportEncodedEntries = [\n${body}\n]\n`
    },
  }
}

