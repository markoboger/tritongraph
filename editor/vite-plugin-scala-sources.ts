import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const RESOLVED = 'virtual:scala-sources'
const VIRTUAL_ID = '\0' + RESOLVED

export interface ScalaSourcesRoot {
  /** Logical name shared with `vite-plugin-sbt-examples` (e.g. `sbt-examples`, `scala-examples`). */
  name: string
  /** Absolute path on disk to scan recursively for `*.scala`/`*.sc` files. */
  dir: string
}

interface ScalaFileEntry {
  /** Originating root name (`sbt-examples`, `scala-examples`, …). */
  root: string
  /** Top-level example dir under `root` (e.g. `01-single-module`, `animal-fruit`). */
  exampleDir: string
  /** Path relative to `<root>/<exampleDir>` (e.g. `core/src/main/scala/com/example/core/Domain.scala`). */
  relPath: string
  /** Contents, base64-encoded UTF-8 (avoids template-literal escape bugs in esbuild). */
  b64: string
}

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      // Skip sbt build outputs and dotfiles; they aren't sources.
      if (ent.name === 'target' || ent.name === 'project' || ent.name.startsWith('.')) continue
      yield* walk(full)
    } else if (ent.isFile() && (ent.name.endsWith('.scala') || ent.name.endsWith('.sc'))) {
      yield full
    }
  }
}

/**
 * Bundles every `*.scala`/`*.sc` file under each registered root's example folders into a single
 * virtual module. Mirrors `vite-plugin-sbt-examples.ts` and uses the same base64 trick so the
 * source survives esbuild's template-literal codegen.
 *
 * Consumer:
 *   import { scalaSourceEncodedEntries } from 'virtual:scala-sources'
 */
export function scalaSourcesVirtualModule(roots: ScalaSourcesRoot[]): Plugin {
  return {
    name: 'virtual:scala-sources',
    enforce: 'pre',
    resolveId(id) {
      if (id === RESOLVED || id.startsWith(`${RESOLVED}?`)) return VIRTUAL_ID
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      const entries: ScalaFileEntry[] = []
      for (const r of roots) {
        if (!fs.existsSync(r.dir)) continue
        for (const ent of fs.readdirSync(r.dir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue
          const exampleRoot = path.join(r.dir, ent.name)
          for (const file of walk(exampleRoot)) {
            this.addWatchFile(file)
            const source = fs.readFileSync(file, 'utf8')
            const relPath = path.relative(exampleRoot, file).split(path.sep).join('/')
            const b64 = Buffer.from(source, 'utf8').toString('base64')
            entries.push({ root: r.name, exampleDir: ent.name, relPath, b64 })
          }
        }
      }
      entries.sort((a, b) => {
        if (a.root !== b.root) return a.root.localeCompare(b.root)
        if (a.exampleDir !== b.exampleDir) return a.exampleDir.localeCompare(b.exampleDir)
        return a.relPath.localeCompare(b.relPath)
      })
      const body = entries.map((e) => JSON.stringify(e)).join(',\n')
      return `export const scalaSourceEncodedEntries = [\n${body}\n]\n`
    },
  }
}
