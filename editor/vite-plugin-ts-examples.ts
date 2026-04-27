import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const RESOLVED = 'virtual:ts-examples'
const VIRTUAL_ID = '\0' + RESOLVED

export interface TsExamplesRoot {
  /** Logical name shown in the menu and used in tab keys (`ts-examples`). */
  name: string
  /** Absolute path on disk to scan for `<exampleDir>/*.ilograph.yaml` files. */
  dir: string
}

export function tsExamplesVirtualModule(roots: TsExamplesRoot[]): Plugin {
  return {
    name: 'virtual:ts-examples',
    enforce: 'pre',
    resolveId(id) {
      if (id === RESOLVED || id.startsWith(`${RESOLVED}?`)) return VIRTUAL_ID
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      const entries: { root: string; dir: string; file: string; source: string; files: Record<string, string> }[] = []
      for (const r of roots) {
        if (!fs.existsSync(r.dir)) continue
        for (const ent of fs.readdirSync(r.dir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue
          const exampleDir = path.join(r.dir, ent.name)
          for (const f of fs.readdirSync(exampleDir)) {
            if (!f.endsWith('.ilograph.yaml') && !f.endsWith('.ilograph.yml')) continue
            const abs = path.join(exampleDir, f)
            if (!fs.existsSync(abs)) continue
            this.addWatchFile(abs)
            const source = fs.readFileSync(abs, 'utf8')
            const files: Record<string, string> = {}
            const srcDir = path.join(exampleDir, 'src')
            if (fs.existsSync(srcDir)) {
              const stack = [srcDir]
              while (stack.length) {
                const cur = stack.pop()!
                for (const child of fs.readdirSync(cur, { withFileTypes: true })) {
                  const childAbs = path.join(cur, child.name)
                  if (child.isDirectory()) {
                    stack.push(childAbs)
                    continue
                  }
                  if (!child.isFile()) continue
                  if (!child.name.endsWith('.ts') && !child.name.endsWith('.tsx')) continue
                  this.addWatchFile(childAbs)
                  const rel = path.relative(exampleDir, childAbs).replace(/\\/g, '/')
                  files[rel] = fs.readFileSync(childAbs, 'utf8')
                }
              }
            }
            entries.push({ root: r.name, dir: ent.name, file: f, source, files })
          }
        }
      }
      entries.sort((a, b) =>
        a.root === b.root ? (a.dir === b.dir ? a.file.localeCompare(b.file) : a.dir.localeCompare(b.dir)) : a.root.localeCompare(b.root),
      )
      const body = entries
        .map((e) => {
          const b64 = Buffer.from(e.source, 'utf8').toString('base64')
          const filesB64: Record<string, string> = {}
          for (const [k, v] of Object.entries(e.files ?? {})) {
            filesB64[k] = Buffer.from(v, 'utf8').toString('base64')
          }
          return JSON.stringify({ root: e.root, dir: e.dir, file: e.file, b64, filesB64 })
        })
        .join(',\n')
      return `export const tsExampleEncodedEntries = [\n${body}\n]\n`
    },
  }
}

