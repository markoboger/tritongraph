import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** Vite's documented convention so dependency scanning resolves this as a virtual module. */
const RESOLVED = 'virtual:sbt-examples'
const VIRTUAL_ID = '\0' + RESOLVED

export interface SbtExamplesRoot {
  /** Logical name shown in the menu and used in tab keys (`sbt-examples`, `scala-examples`, …). */
  name: string
  /** Absolute path on disk to scan for `<exampleDir>/build.sbt` files. */
  dir: string
}

/**
 * Bundles `<dir>/build.sbt` from one or more repo-root example folders into the app.
 *
 * Each emitted entry carries the originating `root` so the consumer (menu, source-path overlay,
 * tab keys) can keep entries from different roots disjoint even when their leaf names collide.
 */
export function sbtExamplesVirtualModule(roots: SbtExamplesRoot[]): Plugin {
  return {
    name: 'virtual:sbt-examples',
    enforce: 'pre',
    resolveId(id) {
      if (id === RESOLVED || id.startsWith(`${RESOLVED}?`)) return VIRTUAL_ID
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      const entries: { root: string; dir: string; source: string }[] = []
      for (const r of roots) {
        if (!fs.existsSync(r.dir)) continue
        for (const ent of fs.readdirSync(r.dir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue
          const buildPath = path.join(r.dir, ent.name, 'build.sbt')
          if (!fs.existsSync(buildPath)) continue
          this.addWatchFile(buildPath)
          const source = fs.readFileSync(buildPath, 'utf8')
          entries.push({ root: r.name, dir: ent.name, source })
        }
      }
      entries.sort((a, b) =>
        a.root === b.root ? a.dir.localeCompare(b.dir) : a.root.localeCompare(b.root),
      )
      /** Emit UTF-8 as base64. Esbuild turns huge `source` string literals into template literals;
       *  Scala sources often contain `` ` `` and `${` which break those literals and crash the app. */
      const body = entries
        .map((e) => {
          const b64 = Buffer.from(e.source, 'utf8').toString('base64')
          return JSON.stringify({ root: e.root, dir: e.dir, b64 })
        })
        .join(',\n')
      return `export const sbtExampleEncodedEntries = [\n${body}\n]\n`
    },
  }
}
