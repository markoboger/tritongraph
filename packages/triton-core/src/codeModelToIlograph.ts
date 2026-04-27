import type { CodeArtefact, CodeContainer, CodeModel, CodeRelation } from './languageModel'
import type { IlographDocument, IlographResource } from './ilographTypes'

export interface CodeModelToIlographOptions {
  resourceId?: string
  title?: string
  description?: string
  projectionMode?: 'single-resource' | 'nested-resources'
}

type TritonMethodSignature = {
  signature: string
  startRow: number
}

type TritonInnerPackageSpec = {
  id: string
  name: string
  subtitle?: string
  innerPackages?: readonly TritonInnerPackageSpec[]
}

type TritonInnerArtefactSpec = {
  id: string
  name: string
  subtitle?: string
  description?: string
  declaration?: string
  constructorSignatures?: readonly TritonMethodSignature[]
  methodSignatures?: readonly TritonMethodSignature[]
  sourceFile?: string
  sourceRow?: number
}

type TritonRelationLabel = 'extends' | 'with' | 'implements' | 'returns' | 'imports' | 'gets' | 'creates'

type TritonInnerArtefactRelationSpec = {
  from: string
  to: string
  label: TritonRelationLabel
  wrapperName?: string
}

type TritonCodeResource = IlographResource & {
  id: string
  'x-triton-node-type'?: 'package'
  'x-triton-package-scope'?: true
  'x-triton-package-language'?: string
  'x-triton-inner-packages'?: readonly TritonInnerPackageSpec[]
  'x-triton-inner-artefacts'?: readonly TritonInnerArtefactSpec[]
  'x-triton-inner-artefact-relations'?: readonly TritonInnerArtefactRelationSpec[]
  'x-triton-cross-artefact-relations'?: readonly TritonInnerArtefactRelationSpec[]
  children?: readonly TritonCodeResource[]
}

function containerToInnerPackage(container: CodeContainer): TritonInnerPackageSpec {
  const innerPackages = container.children.map(containerToInnerPackage)
  return {
    id: container.id,
    name: container.name,
    subtitle: container.kind,
    ...(innerPackages.length ? { innerPackages } : {}),
  }
}

function collectArtefacts(container: CodeContainer, out: CodeArtefact[] = []): CodeArtefact[] {
  out.push(...container.artefacts)
  for (const child of container.children) collectArtefacts(child, out)
  return out
}

function memberSignatures(artefact: CodeArtefact, kind: 'constructor' | 'method' | 'function'): TritonMethodSignature[] {
  return artefact.members
    .filter((m) => m.kind === kind)
    .map((m) => ({
      signature: m.declaration,
      startRow: m.source?.startRow ?? artefact.source.startRow,
    }))
}

function artefactToInnerArtefact(artefact: CodeArtefact): TritonInnerArtefactSpec {
  const constructors = memberSignatures(artefact, 'constructor')
  const methods = [
    ...memberSignatures(artefact, 'method'),
    ...memberSignatures(artefact, 'function'),
  ]
  return {
    id: artefact.id,
    name: artefact.name,
    subtitle: artefact.kind,
    ...(artefact.documentation ? { description: artefact.documentation } : {}),
    declaration: artefact.declaration,
    ...(constructors.length ? { constructorSignatures: constructors } : {}),
    ...(methods.length ? { methodSignatures: methods } : {}),
    sourceFile: artefact.source.file,
    sourceRow: artefact.source.startRow,
  }
}

function relationLabel(rel: CodeRelation): TritonRelationLabel | null {
  if (rel.kind === 'imports') return 'imports'
  if (rel.kind === 'extends') return rel.label === 'with' ? 'with' : 'extends'
  if (rel.kind === 'implements') return 'implements'
  if (rel.kind === 'returns') return 'returns'
  if (rel.kind === 'accepts') return 'gets'
  if (rel.kind === 'creates') return 'creates'
  return null
}

function relationToInnerRelation(rel: CodeRelation): TritonInnerArtefactRelationSpec | null {
  const label = relationLabel(rel)
  if (!label) return null
  const wrapperName = rel.metadata?.wrapperName
  return {
    from: rel.from,
    to: rel.to,
    label,
    ...(typeof wrapperName === 'string' ? { wrapperName } : {}),
  }
}

function endpointContainerId(id: string): string {
  const sep = id.indexOf('::')
  return sep >= 0 ? id.slice(0, sep) : id
}

function relationTouchesContainer(rel: CodeRelation, containerId: string): boolean {
  return endpointContainerId(rel.from) === containerId || endpointContainerId(rel.to) === containerId
}

function relationWithinContainer(rel: CodeRelation, containerId: string): boolean {
  return endpointContainerId(rel.from) === containerId && endpointContainerId(rel.to) === containerId
}

function relationCrossesContainerBoundary(rel: CodeRelation, containerId: string): boolean {
  const from = endpointContainerId(rel.from)
  const to = endpointContainerId(rel.to)
  return from !== to && (from === containerId || to === containerId)
}

function containerSubtitle(container: CodeContainer): string {
  const parts: string[] = [container.kind]
  if (container.children.length) {
    parts.push(`${container.children.length} folder${container.children.length === 1 ? '' : 's'}`)
  }
  if (container.artefacts.length) {
    parts.push(`${container.artefacts.length} artefact${container.artefacts.length === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

function containerToResource(
  container: CodeContainer,
  relations: readonly CodeRelation[],
): TritonCodeResource {
  const children = container.children.map((child) => containerToResource(child, relations))
  const innerArtefacts = container.artefacts.map(artefactToInnerArtefact)
  const innerRelations = relations
    .filter((rel) => rel.kind !== 'imports' && relationWithinContainer(rel, container.id))
    .map(relationToInnerRelation)
    .filter((rel): rel is TritonInnerArtefactRelationSpec => rel !== null)
  const crossRelations = relations
    .filter((rel) => rel.kind !== 'imports' && relationTouchesContainer(rel, container.id))
    .filter((rel) => relationCrossesContainerBoundary(rel, container.id))
    .map(relationToInnerRelation)
    .filter((rel): rel is TritonInnerArtefactRelationSpec => rel !== null)

  return {
    id: container.id,
    name: container.name,
    subtitle: containerSubtitle(container),
    'x-triton-node-type': 'package',
    ...(children.length ? { children } : {}),
    ...(children.length ? { 'x-triton-package-scope': true as const } : {}),
    ...(innerArtefacts.length ? { 'x-triton-inner-artefacts': innerArtefacts } : {}),
    ...(innerRelations.length ? { 'x-triton-inner-artefact-relations': innerRelations } : {}),
    ...(crossRelations.length ? { 'x-triton-cross-artefact-relations': crossRelations } : {}),
  }
}

function containerImportRelations(relations: readonly CodeRelation[]) {
  const out: { from: string; to: string; label: string }[] = []
  const seen = new Set<string>()
  for (const rel of relations) {
    if (rel.kind !== 'imports') continue
    const from = endpointContainerId(rel.from)
    const to = endpointContainerId(rel.to)
    if (!from || !to || from === to) continue
    const key = `${from}\u0001${to}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ from, to, label: 'imports' })
  }
  return out
}

function codeModelToNestedIlographDocument(
  model: CodeModel,
  options: CodeModelToIlographOptions,
): IlographDocument {
  const children = model.root.children.map((container) => containerToResource(container, model.relations))
  const rootResource: TritonCodeResource = {
    id: options.resourceId ?? model.id,
    name: model.name,
    subtitle: `${model.language} project`,
    description: options.description ?? `Code model projection for ${model.name}.`,
    'x-triton-package-scope': true,
    'x-triton-package-language': model.language,
    ...(children.length ? { children } : {}),
  }

  return {
    description: options.description ?? `Code model projection for ${model.name}.`,
    resources: [rootResource],
    perspectives: [
      {
        name: 'dependencies',
        orientation: 'leftToRight',
        relations: containerImportRelations(model.relations),
      },
    ],
  }
}

/**
 * Project a language-neutral code model into the current Triton Ilograph extension fields.
 *
 * This is the compatibility layer that lets new language adapters use the existing renderer while
 * we gradually remove Scala-specific assumptions from the UI.
 */
export function codeModelToIlographDocument(
  model: CodeModel,
  options: CodeModelToIlographOptions = {},
): IlographDocument {
  if (options.projectionMode === 'nested-resources') {
    return codeModelToNestedIlographDocument(model, options)
  }

  const innerPackages = model.root.children.map(containerToInnerPackage)
  const innerArtefacts = collectArtefacts(model.root).map(artefactToInnerArtefact)
  const innerRelations = model.relations
    .map(relationToInnerRelation)
    .filter((r): r is TritonInnerArtefactRelationSpec => r !== null)

  const resource: TritonCodeResource = {
    id: options.resourceId ?? model.id,
    name: model.name,
    subtitle: `${model.language} code model`,
    description: options.description ?? `Code model projection for ${model.name}.`,
    'x-triton-node-type': 'package',
    ...(innerPackages.length ? { 'x-triton-inner-packages': innerPackages } : {}),
    ...(innerArtefacts.length ? { 'x-triton-inner-artefacts': innerArtefacts } : {}),
    ...(innerRelations.length ? { 'x-triton-inner-artefact-relations': innerRelations } : {}),
  }

  return {
    description: options.description ?? `Code model projection for ${model.name}.`,
    resources: [resource],
    perspectives: [{ name: 'dependencies', relations: [] }],
  }
}

