#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { IlographDocument, IlographResource } from './ilographTypes.js'
import { stringifyIlographYaml } from './yamlOut.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type PackageRoot = {
  id: string
  absPath: string
}

type Edge = { from: string; to: string; label: string }

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue'])
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'coverage', 'test-results', '.git'])

function isBareModuleSpecifier(spec: string): boolean {
  return !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('file:')
}

function tryParseImportSpecifiers(code: string): string[] {
  const out: string[] = []

  // import ... from 'x'  OR  export ... from 'x'
  for (const m of code.matchAll(/\b(?:import|export)\s+[^;]*?\sfrom\s+['"]([^'"]+)['"]/g)) {
    out.push(m[1]!)
  }
  // import 'x'
  for (const m of code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) {
    out.push(m[1]!)
  }
  // dynamic import('x')
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push(m[1]!)
  }

  return out
}

function extractVueScriptBodies(vue: string): string {
  let out = ''
  for (const m of vue.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    out += `\n${m[1] ?? ''}\n`
  }
  return out
}

async function listFilesRecursive(rootAbs: string): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [rootAbs]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue
        stack.push(abs)
        continue
      }
      if (!e.isFile()) continue
      const ext = path.extname(e.name)
      if (!SOURCE_EXTS.has(ext)) continue
      out.push(abs)
    }
  }
  return out
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    const s = await stat(abs)
    return s.isFile()
  } catch {
    return false
  }
}

async function resolveRelativeImport(fromFileAbs: string, spec: string): Promise<string | null> {
  const base = path.resolve(path.dirname(fromFileAbs), spec)
  // If spec already points to a file with extension.
  if (path.extname(base)) {
    return (await fileExists(base)) ? base : null
  }
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.vue`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx'),
    path.join(base, 'index.vue'),
  ]
  for (const c of candidates) {
    if (await fileExists(c)) return c
  }
  return null
}

function packageIdForFile(fileAbs: string, packages: readonly PackageRoot[]): string | null {
  // Longest-prefix match.
  let best: PackageRoot | null = null
  for (const p of packages) {
    if (!fileAbs.startsWith(p.absPath + path.sep) && fileAbs !== p.absPath) continue
    if (!best || p.absPath.length > best.absPath.length) best = p
  }
  return best?.id ?? null
}

async function readUtf8(abs: string): Promise<string> {
  return await readFile(abs, 'utf8')
}

function argValue(args: string[], key: string): string | null {
  const idx = args.indexOf(key)
  if (idx < 0) return null
  const v = args[idx + 1]
  return v && !v.startsWith('--') ? v : null
}

function hasArg(args: string[], key: string): boolean {
  return args.includes(key)
}

function fileId(rootId: string, relPath: string): string {
  return `${rootId}:${relPath}`.replace(/\\/g, '/')
}

async function buildPackageFileGraph(opts: {
  repoRoot: string
  packageId: string
  packageAbsPath: string
  scopeRelDir: string
  outPathAbs: string
  title: string
}): Promise<void> {
  const scopeAbs = path.join(opts.packageAbsPath, opts.scopeRelDir)
  const allFiles = await listFilesRecursive(scopeAbs)

  const edgeKey = new Set<string>()
  const edges: Edge[] = []

  const resources: IlographResource[] = [
    {
      id: opts.packageId,
      name: opts.packageId,
      subtitle: `${allFiles.length} files`,
      children: allFiles
        .map((abs) => path.relative(scopeAbs, abs).replace(/\\/g, '/'))
        .sort()
        .map((rel): IlographResource => ({
          id: fileId(opts.packageId, rel),
          name: rel,
        })),
    },
  ]

  const byRel = new Map<string, string>()
  for (const abs of allFiles) {
    const rel = path.relative(scopeAbs, abs).replace(/\\/g, '/')
    byRel.set(abs, rel)
  }

  for (const fileAbs of allFiles) {
    const ext = path.extname(fileAbs)
    const raw = await readUtf8(fileAbs)
    const code = ext === '.vue' ? extractVueScriptBodies(raw) : raw
    const specs = tryParseImportSpecifiers(code)
    const fromRel = byRel.get(fileAbs)
    if (!fromRel) continue
    const fromId = fileId(opts.packageId, fromRel)
    for (const spec of specs) {
      if (isBareModuleSpecifier(spec)) continue
      const resolved = await resolveRelativeImport(fileAbs, spec)
      if (!resolved) continue
      if (!resolved.startsWith(scopeAbs + path.sep)) continue
      const toRel = byRel.get(resolved)
      if (!toRel) continue
      const toId = fileId(opts.packageId, toRel)
      if (fromId === toId) continue
      const k = `${fromId}→${toId}`
      if (edgeKey.has(k)) continue
      edgeKey.add(k)
      edges.push({ from: fromId, to: toId, label: 'imports' })
    }
  }

  const doc: IlographDocument = {
    title: opts.title,
    description:
      `File-level import graph for \`${opts.packageId}\` (${opts.scopeRelDir}/). ` +
      `Only repo-local relative imports resolved within that scope are shown.`,
    resources,
    perspectives: [
      { name: 'typescript imports', relations: edges.map((e) => ({ from: e.from, to: e.to, label: e.label })) },
    ],
  }

  await writeFile(opts.outPathAbs, stringifyIlographYaml(doc), 'utf8')
  console.log(
    `wrote ${path.relative(opts.repoRoot, opts.outPathAbs)} (${allFiles.length} files, ${edges.length} edges)`,
  )
}

type InnerPackageSpec = { id: string; name: string; innerPackages?: InnerPackageSpec[] }
type InnerArtefactSpec = {
  id: string
  name: string
  subtitle?: string
  sourceFile?: string
  sourceRow?: number
}

function posToRow(sf: ts.SourceFile, pos: number): number {
  const lc = sf.getLineAndCharacterOfPosition(pos)
  return lc.line
}

function declKindSubtitle(n: ts.Node): string | undefined {
  if (ts.isInterfaceDeclaration(n)) return 'interface'
  if (ts.isTypeAliasDeclaration(n)) return 'type'
  if (ts.isFunctionDeclaration(n)) return 'function'
  if (ts.isClassDeclaration(n)) return 'class'
  if (ts.isEnumDeclaration(n)) return 'enum'
  return undefined
}

function isExported(decl: ts.Node): boolean {
  const mods = (decl as any).modifiers as ts.NodeArray<ts.Modifier> | undefined
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

async function buildTsPackageArtefactDiagram(opts: {
  repoRoot: string
  packageId: string
  packageAbsPath: string
  scopeRelDir: string
  outPathAbs: string
  title: string
}): Promise<void> {
  const scopeAbs = path.join(opts.packageAbsPath, opts.scopeRelDir)
  const allFiles = (await listFilesRecursive(scopeAbs)).filter((abs) => path.extname(abs) === '.ts')

  const packages = new Map<string, { innerPackages: Set<string>; artefacts: InnerArtefactSpec[] }>()
  function pkgRec(pkgPath: string) {
    if (!packages.has(pkgPath)) {
      packages.set(pkgPath, { innerPackages: new Set(), artefacts: [] })
    }
    return packages.get(pkgPath)!
  }

  for (const abs of allFiles) {
    const rel = path.relative(scopeAbs, abs).replace(/\\/g, '/')
    const pkgPath = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel)
    pkgRec(pkgPath)
  }

  // Establish parent->child package relationships
  for (const pkgPath of packages.keys()) {
    if (!pkgPath) continue
    const parent = path.posix.dirname(pkgPath) === '.' ? '' : path.posix.dirname(pkgPath)
    if (packages.has(parent)) pkgRec(parent).innerPackages.add(pkgPath)
  }

  // Parse artefacts
  const exportByFile = new Map<string, Map<string, InnerArtefactSpec>>() // rel -> name -> artefact
  const exportersByFile = new Map<string, InnerArtefactSpec[]>() // rel -> exported artefacts in that file
  for (const abs of allFiles) {
    const rel = path.relative(scopeAbs, abs).replace(/\\/g, '/')
    const pkgPath = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel)
    const code = await readUtf8(abs)
    const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
    const exportsForFile: InnerArtefactSpec[] = []
    for (const st of sf.statements) {
      const subtitle = declKindSubtitle(st)
      if (!subtitle) continue
      const nameNode = (st as any).name as ts.Identifier | undefined
      const name = nameNode && ts.isIdentifier(nameNode) ? nameNode.text : undefined
      if (!name) continue
      // Prefer exported symbols to match “artefacts” mental model; fallback to all if file has no exports.
      if (!isExported(st)) continue
      const row = posToRow(sf, st.getStart(sf))
      const art: InnerArtefactSpec = {
        id: `${rel}::${name}`,
        name,
        subtitle,
        sourceFile: path.posix.join(opts.packageId, opts.scopeRelDir, rel).replace(/\\/g, '/'),
        sourceRow: row,
      }
      pkgRec(pkgPath).artefacts.push(art)
      exportsForFile.push(art)
    }
    if (exportsForFile.length) {
      exportersByFile.set(rel, exportsForFile)
      const m = new Map<string, InnerArtefactSpec>()
      for (const a of exportsForFile) m.set(a.name, a)
      exportByFile.set(rel, m)
    }
  }

  function buildInner(pkgPath: string): InnerPackageSpec {
    const rec = pkgRec(pkgPath)
    const name = pkgPath ? pkgPath.split('/').slice(-1)[0]! : path.posix.basename(opts.packageAbsPath)
    const childIds = [...rec.innerPackages].sort()
    const innerPackages = childIds.length ? childIds.map(buildInner) : undefined
    const artefacts = rec.artefacts
      .slice()
      .sort((a, b) => (a.subtitle ?? '').localeCompare(b.subtitle ?? '') || a.name.localeCompare(b.name))

    // Encode artefacts using the existing Scala inner-artefact schema.
    return {
      id: pkgPath || '__root__',
      name,
      ...(innerPackages ? { innerPackages } : {}),
      ...(artefacts.length
        ? ({
            // Not part of TritonInnerPackageSpec, but the editor tolerates extra keys on input and
            // we keep the same field name as the package box expects at the leaf node.
            // The renderer reads artefacts from the *leaf node* data, not from innerPackages, so we
            // attach artefacts only to the root flow node below.
          } as any)
        : {}),
    }
  }

  const rootPkg = buildInner('')

  // Attach artefacts to all packages? The current UI reads `data.innerArtefacts` only on the leaf node,
  // so we generate a single package node (like Scala package view) and put *all* artefacts there for now.
  const allArtefacts = [...packages.keys()]
    .flatMap((p) => pkgRec(p).artefacts)
    .sort((a, b) => (a.subtitle ?? '').localeCompare(b.subtitle ?? '') || a.name.localeCompare(b.name))

  // Build “connected diagram” edges between artefacts based on import declarations:
  // exported artefact in file A -> imported artefact in file B (matched by name) labeled 'gets'.
  const relEdges: Array<{ from: string; to: string; label: 'gets' }> = []
  for (const abs of allFiles) {
    const rel = path.relative(scopeAbs, abs).replace(/\\/g, '/')
    const exportedHere = exportersByFile.get(rel)
    if (!exportedHere?.length) continue
    const code = await readUtf8(abs)
    const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st)) continue
      const specLit = st.moduleSpecifier
      if (!ts.isStringLiteral(specLit)) continue
      const spec = specLit.text
      if (isBareModuleSpecifier(spec)) continue
      const resolvedAbs = await resolveRelativeImport(abs, spec)
      if (!resolvedAbs) continue
      if (!resolvedAbs.startsWith(scopeAbs + path.sep)) continue
      const toRel = path.relative(scopeAbs, resolvedAbs).replace(/\\/g, '/')
      const exportedThere = exportByFile.get(toRel)
      if (!exportedThere) continue
      const clause = st.importClause
      if (!clause) continue
      // Named imports: import { A, B as C } from './x'
      const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings : null
      if (!named) continue
      for (const el of named.elements) {
        const importedName = el.propertyName ? el.propertyName.text : el.name.text
        const target = exportedThere.get(importedName)
        if (!target) continue
        for (const src of exportedHere) {
          relEdges.push({ from: src.id, to: target.id, label: 'gets' })
        }
      }
    }
  }

  const doc: IlographDocument = {
    title: opts.title,
    description:
      `TypeScript package view for ${opts.packageId}/${opts.scopeRelDir}. ` +
      `Packages are folders; artefacts are exported interfaces/types/functions/classes/enums.`,
    resources: [
      {
        id: opts.packageId,
        name: opts.packageId,
        subtitle: 'TypeScript packages + artefacts',
        'x-triton-node-type': 'package',
        'x-triton-inner-packages': rootPkg.innerPackages ?? [],
        'x-triton-inner-artefacts': allArtefacts.map((a) => ({
          id: a.id,
          name: a.name,
          subtitle: a.subtitle,
          sourceFile: a.sourceFile,
          sourceRow: a.sourceRow,
        })),
        'x-triton-inner-artefact-relations': relEdges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
      } as any,
    ],
    perspectives: [
      {
        name: 'dependencies',
        relations: [],
      },
    ],
  }

  await mkdir(path.dirname(opts.outPathAbs), { recursive: true })
  await writeFile(opts.outPathAbs, stringifyIlographYaml(doc), 'utf8')
  console.log(
    `wrote ${path.relative(opts.repoRoot, opts.outPathAbs)} (${packages.size} packages, ${allArtefacts.length} artefacts)`,
  )
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..')

  const packageRoots: PackageRoot[] = [
    { id: 'editor', absPath: path.join(repoRoot, 'editor') },
    { id: 'packages/triton-core', absPath: path.join(repoRoot, 'packages', 'triton-core') },
    { id: 'packages/triton-runtime', absPath: path.join(repoRoot, 'packages', 'triton-runtime') },
    { id: 'packages/triton-vscode-extension', absPath: path.join(repoRoot, 'packages', 'triton-vscode-extension') },
    { id: 'tools/sbt-to-ilograph', absPath: path.join(repoRoot, 'tools', 'sbt-to-ilograph') },
    { id: 'tools/ts-to-ilograph', absPath: path.join(repoRoot, 'tools', 'ts-to-ilograph') },
  ]

  const args = process.argv.slice(2)
  const pkgArg = argValue(args, '--package')
  const outArg = argValue(args, '--out')
  const scopeArg = argValue(args, '--scope') ?? 'src'
  const tsPkgs = hasArg(args, '--ts-packages')

  if (pkgArg && outArg) {
    const pkg = packageRoots.find((p) => p.id === pkgArg)
    if (!pkg) {
      console.error(`Unknown package id: ${pkgArg}`)
      process.exit(2)
    }
    const outAbs = path.isAbsolute(outArg) ? outArg : path.join(repoRoot, outArg)
    if (tsPkgs) {
      await buildTsPackageArtefactDiagram({
        repoRoot,
        packageId: pkg.id,
        packageAbsPath: pkg.absPath,
        scopeRelDir: scopeArg,
        outPathAbs: outAbs,
        title: `Triton repo: ${pkg.id} TS packages + artefacts`,
      })
      return
    }
    await buildPackageFileGraph({
      repoRoot,
      packageId: pkg.id,
      packageAbsPath: pkg.absPath,
      scopeRelDir: scopeArg,
      outPathAbs: outAbs,
      title: `Triton repo: ${pkg.id} file imports`,
    })
    return
  }

  // Collect edges between package roots.
  const edgeKey = new Set<string>()
  const edges: Edge[] = []
  const importCountsByPkg = new Map<string, number>()

  for (const pkg of packageRoots) {
    const files = await listFilesRecursive(pkg.absPath)
    for (const fileAbs of files) {
      const ext = path.extname(fileAbs)
      const raw = await readUtf8(fileAbs)
      const code = ext === '.vue' ? extractVueScriptBodies(raw) : raw
      const specs = tryParseImportSpecifiers(code)
      for (const spec of specs) {
        if (isBareModuleSpecifier(spec)) continue
        const resolved = await resolveRelativeImport(fileAbs, spec)
        if (!resolved) continue
        if (!resolved.startsWith(repoRoot + path.sep)) continue
        const fromPkg = packageIdForFile(fileAbs, packageRoots)
        const toPkg = packageIdForFile(resolved, packageRoots)
        if (!fromPkg || !toPkg) continue
        importCountsByPkg.set(fromPkg, (importCountsByPkg.get(fromPkg) ?? 0) + 1)
        if (fromPkg === toPkg) continue
        const k = `${fromPkg}→${toPkg}`
        if (edgeKey.has(k)) continue
        edgeKey.add(k)
        edges.push({ from: fromPkg, to: toPkg, label: 'imports' })
      }
    }
  }

  // sbt “files” side (repo-local inputs to TS tooling)
  const sbtRoots: IlographResource[] = [
    { id: 'sbt-examples', name: 'sbt-examples', subtitle: 'example build.sbt inputs' },
    { id: 'scala-examples', name: 'scala-examples', subtitle: 'example Scala workspaces (sbt)' },
  ]

  // Correspondence edges: these are “data / tooling” edges, not TS import edges.
  const correspondence: Edge[] = [
    { from: 'editor', to: 'sbt-examples', label: 'loads examples' },
    { from: 'editor', to: 'scala-examples', label: 'loads examples' },
    { from: 'tools/sbt-to-ilograph', to: 'sbt-examples', label: 'generates diagrams' },
  ]

  const resources: IlographResource[] = [
    ...packageRoots.map((p): IlographResource => ({
      id: p.id,
      name: p.id,
      subtitle: `${importCountsByPkg.get(p.id) ?? 0} imports scanned`,
    })),
    ...sbtRoots,
  ]

  const doc: IlographDocument = {
    title: 'Triton repo: TypeScript import dependencies + sbt correspondence',
    description:
      'Package-level graph derived from repo-local relative imports (including <script> blocks in .vue files). ' +
      'Also includes correspondence edges to sbt example roots used as inputs.',
    resources,
    perspectives: [
      {
        name: 'typescript imports',
        relations: edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
      },
      {
        name: 'sbt correspondence',
        relations: correspondence.map((e) => ({ from: e.from, to: e.to, label: e.label })),
      },
    ],
  }

  const outPath = path.join(repoRoot, 'repo-typescript-deps.ilograph.yaml')
  await writeFile(outPath, stringifyIlographYaml(doc), 'utf8')
  console.log(`wrote ${path.relative(repoRoot, outPath)} (${edges.length} TS package edges)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

