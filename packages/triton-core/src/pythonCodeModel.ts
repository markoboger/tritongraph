import type {
  CodeArtefact,
  CodeContainer,
  CodeMember,
  CodeModel,
  CodeRelation,
  SourceLocation,
} from './languageModel'

// ─── Parser output types (canonical definitions, also imported by the editor parser) ─────────────

export interface ParsedPythonImport {
  raw: string
  /** Dotted module path, e.g. `"foo.bar"`. Empty for relative-only imports. */
  modulePath: string
  /** Imported names, e.g. `["Baz"]` for `from foo import Baz`. Empty for bare `import foo`. */
  names: string[]
}

export interface ParsedPythonMember {
  name: string
  kind: 'method'
  startRow: number
  endRow: number
  signature: string
}

export interface ParsedPythonArtefact {
  name: string
  kind: 'class' | 'function'
  startRow: number
  endRow: number
  bases: string[]
  decorators: string[]
  members: ParsedPythonMember[]
}

export interface PythonFileSummary {
  /** Dotted module path derived from the file path, e.g. `"nova.api.routes"`. */
  modulePath: string
  filePath: string
  imports: ParsedPythonImport[]
  topLevel: ParsedPythonArtefact[]
}

// ─── CodeModel builder ────────────────────────────────────────────────────────────────────────────

export interface PythonCodeModelOptions {
  id?: string
  name?: string
}

type FileSummaryEntry = { filePath: string; summary: PythonFileSummary }

// Mutable tree node during construction
type ContainerNode = {
  id: string
  name: string
  kind: CodeContainer['kind']
  source?: SourceLocation
  children: Map<string, ContainerNode>
  artefacts: CodeArtefact[]
}

function makeArtefactId(modulePath: string, kind: string, name: string): string {
  return `${modulePath}::${kind}:${name}`
}

function makeMemberId(artId: string, name: string, row: number): string {
  return `${artId}::method:${row}:${name}`
}

function buildMember(artId: string, filePath: string, m: ParsedPythonMember): CodeMember {
  return {
    id: makeMemberId(artId, m.name, m.startRow),
    name: m.name,
    kind: 'method',
    language: 'python',
    declaration: m.signature,
    source: { file: filePath, startRow: m.startRow, endRow: m.endRow },
  }
}

function buildArtefact(filePath: string, modulePath: string, a: ParsedPythonArtefact): CodeArtefact {
  const kind = a.kind === 'class' ? 'class' as const : 'function' as const
  const artId = makeArtefactId(modulePath, kind, a.name)
  const declaration = a.kind === 'class'
    ? (a.bases.length ? `class ${a.name}(${a.bases.join(', ')})` : `class ${a.name}`)
    : `def ${a.name}()`
  return {
    id: artId,
    name: a.name,
    kind,
    language: 'python',
    declaration,
    source: { file: filePath, startRow: a.startRow, endRow: a.endRow },
    members: a.members.map((m) => buildMember(artId, filePath, m)),
  }
}

function ensureContainerPath(root: ContainerNode, segments: string[]): ContainerNode {
  let cur = root
  let prefix = ''
  for (const seg of segments) {
    prefix = prefix ? `${prefix}.${seg}` : seg
    let child = cur.children.get(seg)
    if (!child) {
      child = { id: prefix, name: seg, kind: 'package', children: new Map(), artefacts: [] }
      cur.children.set(seg, child)
    }
    cur = child
  }
  return cur
}

function freezeContainer(node: ContainerNode): CodeContainer {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    language: 'python',
    ...(node.source ? { source: node.source } : {}),
    children: [...node.children.values()].map(freezeContainer),
    artefacts: node.artefacts,
  }
}

function resolveModuleId(
  importPath: string,
  knownModules: ReadonlySet<string>,
): string | undefined {
  if (knownModules.has(importPath)) return importPath
  return undefined
}

export function buildPythonCodeModelFromSummaries(
  entries: readonly FileSummaryEntry[],
  options: PythonCodeModelOptions = {},
): CodeModel {
  const modelId = options.id ?? 'python-workspace'
  const modelName = options.name ?? 'Python Workspace'

  const root: ContainerNode = {
    id: modelId,
    name: modelName,
    kind: 'workspace',
    children: new Map(),
    artefacts: [],
  }

  // Index all known module paths for import resolution
  const knownModules = new Set<string>(entries.map((e) => e.summary.modulePath))

  // Build artefact index for inheritance resolution (simple name → artefact id)
  const artefactBySimpleName = new Map<string, string[]>()

  // Pass 1: build containers and artefacts
  for (const { filePath, summary } of entries) {
    const { modulePath, topLevel } = summary
    const segments = modulePath.split('.')
    const parentSegments = segments.slice(0, -1)
    const leafName = segments[segments.length - 1] ?? modulePath

    // Ensure parent package containers exist
    const parentNode = ensureContainerPath(root, parentSegments)

    // Create the module container
    let moduleNode = parentNode.children.get(leafName)
    if (!moduleNode) {
      moduleNode = {
        id: modulePath,
        name: leafName,
        kind: 'module',
        source: { file: filePath, startRow: 0 },
        children: new Map(),
        artefacts: [],
      }
      parentNode.children.set(leafName, moduleNode)
    }

    // Add artefacts to the module container
    for (const art of topLevel) {
      const codeArt = buildArtefact(filePath, modulePath, art)
      moduleNode.artefacts.push(codeArt)
      const bucket = artefactBySimpleName.get(art.name) ?? []
      bucket.push(codeArt.id)
      artefactBySimpleName.set(art.name, bucket)
    }
  }

  // Pass 2: build relations
  const relations: CodeRelation[] = []
  const seen = new Set<string>()

  for (const { summary } of entries) {
    const { modulePath, imports, topLevel } = summary

    // Import relations (module → module)
    for (const imp of imports) {
      if (!imp.modulePath) continue
      const targetId = resolveModuleId(imp.modulePath, knownModules)
      if (!targetId || targetId === modulePath) continue
      const relId = `rel:import:${modulePath}→${targetId}`
      if (seen.has(relId)) continue
      seen.add(relId)
      relations.push({
        id: relId,
        from: modulePath,
        to: targetId,
        kind: 'imports',
        scope: 'container',
      })
    }

    // Inheritance relations (artefact → artefact)
    for (const art of topLevel) {
      if (art.kind !== 'class' || !art.bases.length) continue
      const childId = makeArtefactId(modulePath, 'class', art.name)
      for (const base of art.bases) {
        const candidates = artefactBySimpleName.get(base) ?? []
        for (const parentId of candidates) {
          if (parentId === childId) continue
          const relId = `rel:extends:${childId}→${parentId}`
          if (seen.has(relId)) continue
          seen.add(relId)
          relations.push({
            id: relId,
            from: childId,
            to: parentId,
            kind: 'extends',
            scope: 'artefact',
          })
        }
      }
    }
  }

  return {
    id: modelId,
    name: modelName,
    language: 'python',
    root: freezeContainer(root),
    relations,
  }
}
