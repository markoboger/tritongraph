import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import type { Plugin } from 'vite'

const RESOLVED = 'virtual:ts-examples'
const VIRTUAL_ID = '\0' + RESOLVED

export interface TsExamplesRoot {
  /** Logical name shown in the menu and used in tab keys (`ts-examples`). */
  name: string
  /** Absolute path on disk to scan for `<exampleDir>/*.ilograph.yaml` files. */
  dir: string
}

type TsSourceRootSpec = {
  path: string
  mount?: string
}

type TsSourceFilePayload = {
  b64: string
  sourceFile?: string
}

type TsExampleScannerOptions = {
  sourceRoot?: string
  modulePaths?: string[]
  ignoredPackageSegments?: string[]
  rootResourceKind?: 'package' | 'project'
}

type TsExampleSourceFile = {
  relPath: string
  sourceFile?: string
  source: string
}

function normalizePosixPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

function tsSourceRootsFromYaml(source: string): TsSourceRootSpec[] {
  const doc = yaml.load(source) as unknown
  if (!doc || typeof doc !== 'object') return []
  const raw = (doc as Record<string, unknown>)['x-triton-ts-source-roots']
  if (!Array.isArray(raw)) return []
  const out: TsSourceRootSpec[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ path: item.trim() })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const rootPath = typeof rec.path === 'string' ? rec.path.trim() : ''
    if (!rootPath) continue
    const mount = typeof rec.mount === 'string' && rec.mount.trim() ? rec.mount.trim() : undefined
    out.push({ path: rootPath, ...(mount ? { mount } : {}) })
  }
  return out
}

function stringListFromYamlValue(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim())
}

function tsScannerOptionsFromYaml(source: string): TsExampleScannerOptions {
  const doc = yaml.load(source) as unknown
  if (!doc || typeof doc !== 'object') return {}
  const rec = doc as Record<string, unknown>
  const sourceRoot = typeof rec['x-triton-ts-source-root'] === 'string'
    ? rec['x-triton-ts-source-root'].trim()
    : ''
  const rootResourceKind = rec['x-triton-root-resource-kind'] === 'project' ? 'project' : undefined
  return {
    ...(sourceRoot ? { sourceRoot } : {}),
    ...(rootResourceKind ? { rootResourceKind } : {}),
    modulePaths: stringListFromYamlValue(rec['x-triton-ts-module-paths']),
    ignoredPackageSegments: stringListFromYamlValue(rec['x-triton-ts-ignored-package-segments']),
  }
}

function shouldSkipDir(name: string): boolean {
  return new Set([
    '.git',
    '.vite',
    'coverage',
    'dist',
    'node_modules',
    'playwright-report',
    'test-results',
  ]).has(name)
}

function collectTypeScriptFiles(input: {
  rootDir: string
  mount: string
  exampleDir: string
  addWatchFile: (file: string) => void
}): TsExampleSourceFile[] {
  const rootDir = path.resolve(input.rootDir)
  if (!fs.existsSync(rootDir)) return []
  const out: TsExampleSourceFile[] = []
  const stack = [rootDir]
  while (stack.length) {
    const cur = stack.pop()!
    for (const child of fs.readdirSync(cur, { withFileTypes: true })) {
      if (shouldSkipDir(child.name)) continue
      const childAbs = path.join(cur, child.name)
      const stat = fs.statSync(childAbs)
      if (stat.isDirectory()) {
        stack.push(childAbs)
        continue
      }
      if (!stat.isFile()) continue
      if (!child.name.endsWith('.ts') && !child.name.endsWith('.tsx')) continue
      input.addWatchFile(childAbs)
      const relUnderRoot = path.relative(rootDir, childAbs).replace(/\\/g, '/')
      const relPath = normalizePosixPath(path.posix.join(normalizePosixPath(input.mount), relUnderRoot))
      const sourceFile = normalizePosixPath(path.relative(input.exampleDir, childAbs))
      out.push({ relPath, sourceFile: sourceFile === relPath ? undefined : sourceFile, source: fs.readFileSync(childAbs, 'utf8') })
    }
  }
  return out
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
      const entries: {
        root: string
        dir: string
        file: string
        source: string
        files: TsExampleSourceFile[]
        scannerOptions: TsExampleScannerOptions
      }[] = []
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
            const scannerOptions = tsScannerOptionsFromYaml(source)
            const files: TsExampleSourceFile[] = []
            const srcDir = path.join(exampleDir, 'src')
            files.push(...collectTypeScriptFiles({
              rootDir: srcDir,
              mount: 'src',
              exampleDir,
              addWatchFile: (file) => this.addWatchFile(file),
            }))
            for (const spec of tsSourceRootsFromYaml(source)) {
              const rootDir = path.resolve(exampleDir, spec.path)
              const defaultMount = path.posix.join('src', path.basename(rootDir))
              files.push(...collectTypeScriptFiles({
                rootDir,
                mount: spec.mount ?? defaultMount,
                exampleDir,
                addWatchFile: (file) => this.addWatchFile(file),
              }))
            }
            entries.push({ root: r.name, dir: ent.name, file: f, source, files, scannerOptions })
          }
        }
      }
      entries.sort((a, b) =>
        a.root === b.root ? (a.dir === b.dir ? a.file.localeCompare(b.file) : a.dir.localeCompare(b.dir)) : a.root.localeCompare(b.root),
      )
      const body = entries
        .map((e) => {
          const b64 = Buffer.from(e.source, 'utf8').toString('base64')
          const filesB64: Record<string, TsSourceFilePayload> = {}
          for (const file of e.files ?? []) {
            filesB64[file.relPath] = {
              b64: Buffer.from(file.source, 'utf8').toString('base64'),
              ...(file.sourceFile ? { sourceFile: file.sourceFile } : {}),
            }
          }
          return JSON.stringify({ root: e.root, dir: e.dir, file: e.file, b64, filesB64, scannerOptions: e.scannerOptions })
        })
        .join(',\n')
      return `export const tsExampleEncodedEntries = [\n${body}\n]\n`
    },
  }
}

