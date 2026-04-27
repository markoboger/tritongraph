import ts from 'typescript'
import type {
  CodeArtefact,
  CodeArtefactKind,
  CodeContainer,
  CodeMember,
  CodeMemberKind,
  CodeModel,
  CodeRelation,
  SourceLocation,
} from './languageModel'

export interface TypeScriptSourceFile {
  relPath: string
  source: string
}

export interface TypeScriptCodeModelOptions {
  id?: string
  name?: string
  /**
   * Optional source root to remove from container ids while preserving source file paths.
   *
   * Example: with `sourceRoot: 'src'`, `src/animals/Dog.ts` belongs to package `animals`
   * but its source location remains `src/animals/Dog.ts` for IDE links.
   */
  sourceRoot?: string
}

type ParsedFile = {
  file: TypeScriptSourceFile
  sourceFile: ts.SourceFile
  packageId: string
  artefacts: CodeArtefact[]
  exportsByName: Map<string, CodeArtefact>
}

type MutableContainer = {
  id: string
  name: string
  children: Map<string, MutableContainer>
  artefacts: CodeArtefact[]
}

const SOURCE_CANDIDATE_EXTS = ['.ts', '.tsx', '.js', '.jsx']
const INDEX_CANDIDATES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx']

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function posixNormalize(relPath: string): string {
  const parts: string[] = []
  for (const part of normalizeRelPath(relPath).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function posixDirname(relPath: string): string {
  const normalized = normalizeRelPath(relPath)
  const slash = normalized.lastIndexOf('/')
  return slash < 0 ? '.' : normalized.slice(0, slash) || '.'
}

function posixExtname(relPath: string): string {
  const base = normalizeRelPath(relPath).split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot) : ''
}

function packageIdForRelPath(relPath: string): string {
  const dir = posixDirname(normalizeRelPath(relPath))
  return dir === '.' ? '<root>' : dir
}

function logicalRelPathForPackage(relPath: string, sourceRoot: string | undefined): string {
  const normalized = normalizeRelPath(relPath)
  const root = sourceRoot ? normalizeRelPath(sourceRoot).replace(/\/+$/, '') : ''
  if (!root) return normalized
  if (normalized === root) return ''
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized
}

function packageDisplayName(id: string): string {
  if (id === '<root>') return '<root>'
  return id.split('/').filter(Boolean).pop() || id
}

function sourceLocation(sf: ts.SourceFile, file: string, pos: number, end?: number): SourceLocation {
  const start = sf.getLineAndCharacterOfPosition(pos)
  const out: SourceLocation = {
    file,
    startRow: start.line,
    startColumn: start.character,
  }
  if (end !== undefined) {
    const finish = sf.getLineAndCharacterOfPosition(end)
    out.endRow = finish.line
    out.endColumn = finish.character
  }
  return out
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function declarationName(node: ts.Node): string | null {
  if (
    (ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isEnumDeclaration(node)
      || ts.isFunctionDeclaration(node))
    && node.name
  ) {
    return node.name.text
  }
  return null
}

function artefactKind(node: ts.Node): CodeArtefactKind | null {
  if (ts.isClassDeclaration(node)) return 'class'
  if (ts.isInterfaceDeclaration(node)) return 'interface'
  if (ts.isTypeAliasDeclaration(node)) return 'type'
  if (ts.isEnumDeclaration(node)) return 'enum'
  if (ts.isFunctionDeclaration(node)) return 'function'
  return null
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function declarationText(node: ts.Node, sf: ts.SourceFile): string {
  const full = node.getText(sf)
  const brace = full.indexOf('{')
  if (brace >= 0) return oneLine(full.slice(0, brace))
  return oneLine(full)
}

function docText(node: ts.Node): string | undefined {
  const ranges = ts.getJSDocCommentsAndTags(node)
  const comments = ranges.filter(ts.isJSDoc)
  if (!comments.length) return undefined
  const latest = comments[comments.length - 1]
  const comment = latest.comment
  if (typeof comment === 'string') return comment.trim() || undefined
  return undefined
}

function memberName(node: ts.Node): string | null {
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  if (
    (ts.isMethodDeclaration(node)
      || ts.isMethodSignature(node)
      || ts.isPropertyDeclaration(node)
      || ts.isPropertySignature(node))
    && node.name
  ) {
    return node.name.getText()
  }
  return null
}

function memberKind(node: ts.Node): CodeMemberKind | null {
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return 'method'
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return 'property'
  if (ts.isCallSignatureDeclaration(node)) return 'call-signature'
  return null
}

function memberDeclarationText(node: ts.Node, sf: ts.SourceFile): string {
  const full = node.getText(sf)
  const brace = full.indexOf('{')
  if (brace >= 0) return oneLine(full.slice(0, brace))
  return oneLine(full)
}

function membersForArtefact(artId: string, node: ts.Node, sf: ts.SourceFile, file: string): CodeMember[] {
  const members: CodeMember[] = []
  const addMember = (member: ts.Node) => {
    const kind = memberKind(member)
    if (!kind) return
    const name = memberName(member) ?? kind
    members.push({
      id: `${artId}::${kind}:${member.getStart(sf)}:${name}`,
      name,
      kind,
      language: 'typescript',
      declaration: memberDeclarationText(member, sf),
      source: sourceLocation(sf, file, member.getStart(sf), member.getEnd()),
      ...(docText(member) ? { documentation: docText(member) } : {}),
    })
  }

  if (ts.isClassDeclaration(node)) {
    for (const m of node.members) addMember(m)
  } else if (ts.isInterfaceDeclaration(node)) {
    for (const m of node.members) addMember(m)
  }

  return members
}

function ensureContainer(root: MutableContainer, packageId: string): MutableContainer {
  if (packageId === '<root>') return root
  let cur = root
  const segments = packageId.split('/').filter(Boolean)
  let id = ''
  for (const segment of segments) {
    id = id ? `${id}/${segment}` : segment
    let next = cur.children.get(id)
    if (!next) {
      next = {
        id,
        name: packageDisplayName(id),
        children: new Map(),
        artefacts: [],
      }
      cur.children.set(id, next)
    }
    cur = next
  }
  return cur
}

function freezeContainer(c: MutableContainer): CodeContainer {
  return {
    id: c.id,
    name: c.name,
    kind: c.id === '<root>' ? 'workspace' : 'folder',
    language: 'typescript',
    children: [...c.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(freezeContainer),
    artefacts: c.artefacts.slice().sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function resolveRelativeImport(fromRelPath: string, spec: string, filesByRel: ReadonlyMap<string, ParsedFile>): string | null {
  if (!spec.startsWith('.')) return null
  const fromDir = posixDirname(fromRelPath)
  const base = posixNormalize(`${fromDir}/${spec}`)
  if (posixExtname(base) && filesByRel.has(base)) return base
  for (const ext of SOURCE_CANDIDATE_EXTS) {
    const candidate = `${base}${ext}`
    if (filesByRel.has(candidate)) return candidate
  }
  for (const index of INDEX_CANDIDATES) {
    const candidate = `${base}/${index}`
    if (filesByRel.has(candidate)) return candidate
  }
  return null
}

function importedNamesFromDeclaration(node: ts.ImportDeclaration): string[] {
  const clause = node.importClause
  if (!clause) return []
  const names: string[] = []
  if (clause.name) names.push(clause.name.text)
  const bindings = clause.namedBindings
  if (bindings && ts.isNamedImports(bindings)) {
    for (const el of bindings.elements) {
      names.push(el.propertyName?.text ?? el.name.text)
    }
  }
  return names
}

function typeNamesFromTypeNode(type: ts.TypeNode | undefined): string[] {
  if (!type) return []
  const out = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName
      if (ts.isIdentifier(name)) out.add(name.text)
      else out.add(name.right.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(type)
  return [...out]
}

function addRelation(out: CodeRelation[], rel: Omit<CodeRelation, 'id'>) {
  out.push({
    id: `${rel.scope}:${rel.kind}:${rel.from}->${rel.to}:${out.length}`,
    ...rel,
  })
}

function parseFile(file: TypeScriptSourceFile, options: TypeScriptCodeModelOptions): ParsedFile {
  const relPath = normalizeRelPath(file.relPath)
  const sf = ts.createSourceFile(relPath, file.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const packageId = packageIdForRelPath(logicalRelPathForPackage(relPath, options.sourceRoot))
  const artefacts: CodeArtefact[] = []
  const exportsByName = new Map<string, CodeArtefact>()

  for (const statement of sf.statements) {
    const kind = artefactKind(statement)
    if (!kind || !isExported(statement)) continue
    const name = declarationName(statement)
    if (!name) continue
    const id = `${packageId}::${kind}:${name}`
    const art: CodeArtefact = {
      id,
      name,
      kind,
      language: 'typescript',
      declaration: declarationText(statement, sf),
      source: sourceLocation(sf, relPath, statement.getStart(sf), statement.getEnd()),
      ...(docText(statement) ? { documentation: docText(statement) } : {}),
      members: membersForArtefact(id, statement, sf, relPath),
    }
    artefacts.push(art)
    exportsByName.set(name, art)
  }

  return { file: { relPath, source: file.source }, sourceFile: sf, packageId, artefacts, exportsByName }
}

/**
 * Build a TypeScript code model from already-loaded source files.
 *
 * Folders are modeled as containers; exported top-level declarations are modeled as artefacts.
 * Relative imports are resolved against the provided file set so the adapter stays pure and does not
 * need filesystem access.
 */
export function buildTypeScriptCodeModelFromFiles(
  files: readonly TypeScriptSourceFile[],
  options: TypeScriptCodeModelOptions = {},
): CodeModel {
  const parsed = files.map((file) => parseFile(file, options))
  const byRel = new Map(parsed.map((p) => [p.file.relPath, p] as const))
  const root: MutableContainer = {
    id: '<root>',
    name: options.name ?? 'TypeScript',
    children: new Map(),
    artefacts: [],
  }

  for (const p of parsed) {
    const container = ensureContainer(root, p.packageId)
    container.artefacts.push(...p.artefacts)
  }

  const relations: CodeRelation[] = []
  const importedByFile = new Map<string, Map<string, CodeArtefact>>()
  for (const p of parsed) {
    const imports = new Map<string, CodeArtefact>()
    for (const statement of p.sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const spec = statement.moduleSpecifier
      if (!ts.isStringLiteral(spec)) continue
      const targetRel = resolveRelativeImport(p.file.relPath, spec.text, byRel)
      if (!targetRel) continue
      const target = byRel.get(targetRel)
      if (!target) continue
      if (p.packageId !== target.packageId) {
        addRelation(relations, {
          from: p.packageId,
          to: target.packageId,
          kind: 'imports',
          scope: 'container',
          source: sourceLocation(p.sourceFile, p.file.relPath, statement.getStart(p.sourceFile), statement.getEnd()),
        })
      }
      for (const name of importedNamesFromDeclaration(statement)) {
        const art = target.exportsByName.get(name)
        if (art) imports.set(name, art)
      }
    }
    importedByFile.set(p.file.relPath, imports)
  }

  const resolveTypeName = (p: ParsedFile, name: string): CodeArtefact | undefined =>
    p.exportsByName.get(name) ?? importedByFile.get(p.file.relPath)?.get(name)

  for (const p of parsed) {
    for (const statement of p.sourceFile.statements) {
      const artName = declarationName(statement)
      if (!artName) continue
      const art = p.exportsByName.get(artName)
      if (!art) continue

      if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
        for (const clause of statement.heritageClauses ?? []) {
          const kind = clause.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends'
          for (const type of clause.types) {
            const target = resolveTypeName(p, type.expression.getText(p.sourceFile))
            if (!target) continue
            addRelation(relations, {
              from: art.id,
              to: target.id,
              kind,
              scope: 'artefact',
              source: sourceLocation(p.sourceFile, p.file.relPath, type.getStart(p.sourceFile), type.getEnd()),
            })
          }
        }
      }

      const memberByStart = new Map(art.members.map((m) => [m.source?.startColumn == null ? '' : `${m.source.file}:${m.source.startRow}:${m.source.startColumn}`, m]))
      const ownerForNode = (node: ts.Node): string => {
        const loc = sourceLocation(p.sourceFile, p.file.relPath, node.getStart(p.sourceFile), node.getEnd())
        const key = `${loc.file}:${loc.startRow}:${loc.startColumn ?? ''}`
        return memberByStart.get(key)?.id ?? art.id
      }

      const addAccepts = (ownerId: string, params: readonly ts.ParameterDeclaration[]) => {
        for (const param of params) {
          for (const name of typeNamesFromTypeNode(param.type)) {
            const target = resolveTypeName(p, name)
            if (!target) continue
            addRelation(relations, {
              from: ownerId,
              to: target.id,
              kind: 'accepts',
              scope: ownerId === art.id ? 'artefact' : 'member',
              source: sourceLocation(p.sourceFile, p.file.relPath, param.getStart(p.sourceFile), param.getEnd()),
            })
          }
        }
      }

      const addReturns = (ownerId: string, type: ts.TypeNode | undefined) => {
        for (const name of typeNamesFromTypeNode(type)) {
          const target = resolveTypeName(p, name)
          if (!target) continue
          addRelation(relations, {
            from: ownerId,
            to: target.id,
            kind: 'returns',
            scope: ownerId === art.id ? 'artefact' : 'member',
            source: type ? sourceLocation(p.sourceFile, p.file.relPath, type.getStart(p.sourceFile), type.getEnd()) : undefined,
          })
        }
      }

      if (ts.isFunctionDeclaration(statement)) {
        addAccepts(art.id, statement.parameters)
        addReturns(art.id, statement.type)
      } else if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
        for (const member of statement.members) {
          if (ts.isConstructorDeclaration(member)) {
            addAccepts(ownerForNode(member), member.parameters)
          } else if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
            const owner = ownerForNode(member)
            addAccepts(owner, member.parameters)
            addReturns(owner, member.type)
          } else if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
            addReturns(ownerForNode(member), member.type)
          }
        }
      }
    }
  }

  return {
    id: options.id ?? 'typescript',
    name: options.name ?? 'TypeScript',
    language: 'typescript',
    root: freezeContainer(root),
    relations,
  }
}

