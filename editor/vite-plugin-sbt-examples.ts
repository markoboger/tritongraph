import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** Vite’s documented convention so dependency scanning resolves this as a virtual module. */
const RESOLVED = 'virtual:sbt-examples'
const VIRTUAL_ID = '\0' + RESOLVED

/**
 * Bundles repo-root sbt-examples into the app. Vite import.meta.glob only matches inside the
 * editor project root, so repo-root examples need this plugin.
 */
export function sbtExamplesVirtualModule(sbtExamplesDir: string): Plugin {
  return {
    name: 'virtual:sbt-examples',
    enforce: 'pre',
    resolveId(id) {
      if (id === RESOLVED || id.startsWith(`${RESOLVED}?`)) return VIRTUAL_ID
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      const entries: { dir: string; source: string }[] = []
      if (fs.existsSync(sbtExamplesDir)) {
        for (const ent of fs.readdirSync(sbtExamplesDir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue
          const buildPath = path.join(sbtExamplesDir, ent.name, 'build.sbt')
          if (!fs.existsSync(buildPath)) continue
          this.addWatchFile(buildPath)
          const source = fs.readFileSync(buildPath, 'utf8')
          entries.push({ dir: ent.name, source })
        }
      }
      entries.sort((a, b) => a.dir.localeCompare(b.dir))
      // Emit UTF-8 as base64. Esbuild turns huge `source` string literals into template literals;
      // Scala sources often contain `` ` `` and `${` which break those literals and crash the app.
      const body = entries
        .map((e) => {
          const b64 = Buffer.from(e.source, 'utf8').toString('base64')
          return JSON.stringify({ dir: e.dir, b64 })
        })
        .join(',\n')
      return `export const sbtExampleEncodedEntries = [\n${body}\n]\n`
    },
  }
}
