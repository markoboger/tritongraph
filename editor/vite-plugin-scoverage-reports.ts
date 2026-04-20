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
          // Default sbt layout for scoverage reports:
          //   target/scala-<binary>/scoverage-report/scoverage.xml
          // where `<binary>` is e.g. `2.13` or `3.8.3`.
          const targetDir = path.join(exampleRoot, 'target')
          if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) continue
          const scalaDirs = fs
            .readdirSync(targetDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith('scala-'))
            .map((d) => d.name)
            .sort()
            .reverse()
          let xml: string | null = null
          let relPath: string | null = null
          for (const sd of scalaDirs) {
            const candidate = path.join(targetDir, sd, 'scoverage-report', 'scoverage.xml')
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              xml = candidate
              relPath = `target/${sd}/scoverage-report/scoverage.xml`
              break
            }
          }
          if (!xml || !relPath) continue
          this.addWatchFile(xml)
          const source = fs.readFileSync(xml, 'utf8')
          const b64 = Buffer.from(source, 'utf8').toString('base64')
          entries.push({ root: r.name, exampleDir: ent.name, relPath, b64 })
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

