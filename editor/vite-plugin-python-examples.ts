import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const RESOLVED = 'virtual:python-examples'
const VIRTUAL_ID = '\0' + RESOLVED

export interface PythonExamplesRoot {
  name: string
  dir: string
}

const SKIP_DIRS = new Set([
  '.git', '.venv', '__pycache__', '.pytest_cache', '.ruff_cache', 'dist', 'node_modules',
])

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name)
}

function collectPythonFiles(
  exampleDir: string,
  addWatchFile: (f: string) => void,
): Array<{ relPath: string; source: string }> {
  const out: Array<{ relPath: string; source: string }> = []
  const stack = [exampleDir]
  while (stack.length) {
    const cur = stack.pop()!
    for (const child of fs.readdirSync(cur, { withFileTypes: true })) {
      if (shouldSkipDir(child.name)) continue
      const abs = path.join(cur, child.name)
      if (fs.statSync(abs).isDirectory()) { stack.push(abs); continue }
      if (!child.name.endsWith('.py')) continue
      addWatchFile(abs)
      const relPath = path.relative(exampleDir, abs).replace(/\\/g, '/')
      out.push({ relPath, source: fs.readFileSync(abs, 'utf8') })
    }
  }
  return out
}

export function pythonExamplesVirtualModule(roots: PythonExamplesRoot[]): Plugin {
  return {
    name: 'virtual:python-examples',
    enforce: 'pre',
    resolveId(id) {
      if (id === RESOLVED) return VIRTUAL_ID
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      const entries: Array<{ root: string; dir: string; filesB64: Record<string, string> }> = []
      for (const r of roots) {
        if (!fs.existsSync(r.dir)) continue
        for (const ent of fs.readdirSync(r.dir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue
          if (shouldSkipDir(ent.name)) continue
          const exampleDir = path.join(r.dir, ent.name)
          const files = collectPythonFiles(exampleDir, (f) => this.addWatchFile(f))
          if (!files.length) continue
          const filesB64: Record<string, string> = {}
          for (const f of files) {
            filesB64[f.relPath] = Buffer.from(f.source, 'utf8').toString('base64')
          }
          entries.push({ root: r.name, dir: ent.name, filesB64 })
        }
      }
      entries.sort((a, b) =>
        a.root === b.root ? a.dir.localeCompare(b.dir) : a.root.localeCompare(b.root),
      )
      const body = entries.map((e) => JSON.stringify(e)).join(',\n')
      return `export const pythonExampleEncodedEntries = [\n${body}\n]\n`
    },
  }
}
