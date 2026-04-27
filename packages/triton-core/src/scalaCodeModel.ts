import type {
  CodeArtefact,
  CodeArtefactKind,
  CodeContainer,
  CodeMember,
  CodeModel,
  CodeRelation,
  SourceLocation,
} from './languageModel'
import {
  artefactResourceId,
  type ParsedScalaMethodSignature,
  type ScalaArtefact,
  type ScalaPackageGraph,
  type ScalaPackageNode,
} from './scalaPackageGraph'

export interface ScalaCodeModelOptions {
  id?: string
  name?: string
}

function sourceLocation(file: string, startRow: number): SourceLocation {
  return { file, startRow }
}

function scalaArtefactKind(kind: string): CodeArtefactKind {
  switch (kind) {
    case 'class':
      return 'class'
    case 'case class':
      return 'case-class'
    case 'object':
      return 'object'
    case 'case object':
      return 'case-object'
    case 'trait':
      return 'trait'
    case 'enum':
      return 'enum'
    case 'def':
      return 'function'
    case 'val':
      return 'value'
    case 'var':
      return 'variable'
    case 'given':
      return 'given'
    case 'type':
      return 'type'
    default:
      return 'unknown'
  }
}

function methodMember(artId: string, file: string, method: ParsedScalaMethodSignature): CodeMember {
  const nameMatch = method.signature.match(/^\s*(?:def\s+)?([A-Za-z_$][\w$]*)/)
  const name = nameMatch?.[1] ?? method.signature
  return {
    id: `${artId}::method:${method.startRow}:${name}`,
    name,
    kind: 'method',
    language: 'scala',
    declaration: method.signature,
    source: sourceLocation(file, method.startRow),
  }
}

function constructorMember(artId: string, art: ScalaArtefact): CodeMember | null {
  if (!art.constructorParams) return null
  return {
    id: `${artId}::constructor:${art.startRow}`,
    name: art.name,
    kind: 'constructor',
    language: 'scala',
    declaration: `${art.kind} ${art.name}${art.constructorParams}`,
    source: sourceLocation(art.file, art.startRow),
  }
}

function codeArtefact(pkgName: string, art: ScalaArtefact): CodeArtefact {
  const id = artefactResourceId(pkgName, art)
  const ctor = constructorMember(id, art)
  const members = [
    ...(ctor ? [ctor] : []),
    ...art.methodSignatures.map((m) => methodMember(id, art.file, m)),
  ]
  return {
    id,
    name: art.name,
    kind: scalaArtefactKind(art.kind),
    language: 'scala',
    declaration: art.declaration,
    source: sourceLocation(art.file, art.startRow),
    ...(art.doc ? { documentation: art.doc } : {}),
    members,
  }
}

type MutableContainer = {
  id: string
  name: string
  children: Map<string, MutableContainer>
  artefacts: CodeArtefact[]
}

function packageDisplayName(id: string): string {
  if (id === '<root>') return '<root>'
  return id.split('.').pop() || id
}

function ensurePackageContainer(root: MutableContainer, packageName: string): MutableContainer {
  if (packageName === '<root>') return root
  let cur = root
  const segments = packageName.split('.').filter(Boolean)
  let fqn = ''
  for (const segment of segments) {
    fqn = fqn ? `${fqn}.${segment}` : segment
    let next = cur.children.get(fqn)
    if (!next) {
      next = {
        id: fqn,
        name: packageDisplayName(fqn),
        children: new Map(),
        artefacts: [],
      }
      cur.children.set(fqn, next)
    }
    cur = next
  }
  return cur
}

function freezeContainer(c: MutableContainer): CodeContainer {
  return {
    id: c.id,
    name: c.name,
    kind: c.id === '<root>' ? 'workspace' : 'package',
    language: 'scala',
    children: [...c.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(freezeContainer),
    artefacts: c.artefacts.slice().sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function packageArtefactById(packages: readonly ScalaPackageNode[]): Map<string, ScalaArtefact> {
  const out = new Map<string, ScalaArtefact>()
  for (const pkg of packages) {
    for (const art of pkg.artefacts) {
      out.set(artefactResourceId(pkg.name, art), art)
    }
  }
  return out
}

/**
 * Project the Scala-specific package graph into Triton's language-neutral code model.
 *
 * This is intentionally a pure adapter: it does not change Scala parsing, existing Ilograph
 * projection, or Vue rendering. The next projection layer can consume `CodeModel` without
 * depending on Scala-specific names like `with` or `gets`.
 */
export function scalaPackageGraphToCodeModel(
  graph: ScalaPackageGraph,
  options: ScalaCodeModelOptions = {},
): CodeModel {
  const modelId = options.id ?? 'scala'
  const root: MutableContainer = {
    id: '<root>',
    name: options.name ?? 'Scala',
    children: new Map(),
    artefacts: [],
  }

  for (const pkg of graph.packages) {
    const container = ensurePackageContainer(root, pkg.name)
    container.artefacts.push(...pkg.artefacts.map((a) => codeArtefact(pkg.name, a)))
  }

  const artefacts = packageArtefactById(graph.packages)
  const relations: CodeRelation[] = []
  const addRelation = (rel: Omit<CodeRelation, 'id'>) => {
    relations.push({
      id: `${rel.scope}:${rel.kind}:${rel.from}->${rel.to}:${relations.length}`,
      ...rel,
    })
  }

  for (const edge of graph.edges) {
    addRelation({
      from: edge.from,
      to: edge.to,
      kind: 'imports',
      scope: 'container',
      metadata: { weight: edge.weight },
    })
  }

  for (const edge of graph.inheritance) {
    const source = artefacts.get(edge.fromArtefactId)
    addRelation({
      from: edge.fromArtefactId,
      to: edge.toArtefactId,
      kind: 'extends',
      scope: 'artefact',
      ...(source ? { source: sourceLocation(source.file, source.startRow) } : {}),
      ...(edge.kind === 'with' ? { label: 'with' } : {}),
    })
  }

  for (const edge of graph.gets) {
    const source = artefacts.get(edge.fromArtefactId)
    addRelation({
      from: edge.fromArtefactId,
      to: edge.toArtefactId,
      kind: 'accepts',
      scope: 'artefact',
      ...(source ? { source: sourceLocation(source.file, source.startRow) } : {}),
      ...(edge.wrapperName ? { metadata: { wrapperName: edge.wrapperName } } : {}),
    })
  }

  for (const edge of graph.creates) {
    const source = artefacts.get(edge.fromArtefactId)
    addRelation({
      from: edge.fromArtefactId,
      to: edge.toArtefactId,
      kind: 'creates',
      scope: 'artefact',
      ...(source ? { source: sourceLocation(source.file, source.startRow) } : {}),
    })
  }

  return {
    id: modelId,
    name: options.name ?? 'Scala',
    language: 'scala',
    root: freezeContainer(root),
    relations,
  }
}

