import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const RESOLVED = 'virtual:sbt-test-logs'
const VIRTUAL_ID = '\0' + RESOLVED

export interface ExampleRoot {
  /** Logical name shared with the other virtual modules (e.g. `scala-examples`). */
  name: string
  /** Absolute path to the examples root directory. */
  dir: string
}

interface LogEntry {
  root: string
  exampleDir: string
  relPath: string
  b64: string
}

/**
 * Bundle `sbt test` console output captured to `sbt-test.log` files under example roots.
 *
 * This keeps the browser runtime pure: the editor consumes logs from a virtual module,
 * similar to how Scala sources are imported via `virtual:scala-sources`.
 */
export function sbtTestLogsVirtualModule(roots: ExampleRoot[]): Plugin {
  return {
    name: 'virtual:sbt-test-logs',
    enforce: 'pre',
    resolveId(id) {
      if (id === RESOLVED || id.startsWith(`${RESOLVED}?`)) return VIRTUAL_ID
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      const entries: LogEntry[] = []
      for (const r of roots) {
        if (!fs.existsSync(r.dir)) continue
        for (const ent of fs.readdirSync(r.dir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue
          const exampleRoot = path.join(r.dir, ent.name)
          const logFile = path.join(exampleRoot, 'sbt-test.log')
          if (!fs.existsSync(logFile) || !fs.statSync(logFile).isFile()) continue
          this.addWatchFile(logFile)
          const source = fs.readFileSync(logFile, 'utf8')
          const b64 = Buffer.from(source, 'utf8').toString('base64')
          entries.push({ root: r.name, exampleDir: ent.name, relPath: 'sbt-test.log', b64 })
        }
      }
      entries.sort((a, b) => {
        if (a.root !== b.root) return a.root.localeCompare(b.root)
        return a.exampleDir.localeCompare(b.exampleDir)
      })
      const body = entries.map((e) => JSON.stringify(e)).join(',\n')
      return `export const sbtTestLogEncodedEntries = [\n${body}\n]\n`
    },
  }
}

