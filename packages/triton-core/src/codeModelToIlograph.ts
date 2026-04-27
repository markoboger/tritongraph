import type { CodeArtefact, CodeContainer, CodeModel, CodeRelation } from './languageModel'
import type { IlographDocument, IlographResource } from './ilographTypes'

export interface CodeModelToIlographOptions {
  resourceId?: string
  title?: string
  description?: string
  projectionMode?: 'single-resource' | 'nested-resources'
  rootResourceKind?: 'package' | 'project'
  scopeContainerId?: string
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
  'x-triton-node-type'?: 'package' | 'artefact'
  'x-triton-project-kind'?: 'project' | 'module' | 'general'
  'x-triton-package-scope'?: true
  'x-triton-package-language'?: string
  'x-triton-declaration'?: string
  'x-triton-constructor-signatures'?: readonly TritonMethodSignature[]
  'x-triton-method-signatures'?: readonly TritonMethodSignature[]
  'x-triton-source-file'?: string
  'x-triton-source-row'?: number
  'x-triton-inner-packages'?: readonly TritonInnerPackageSpec[]
  'x-triton-inner-artefacts'?: readonly TritonInnerArtefactSpec[]
  'x-triton-inner-artefact-relations'?: readonly TritonInnerArtefactRelationSpec[]
  'x-triton-cross-artefact-relations'?: readonly TritonInnerArtefactRelationSpec[]
  children?: readonly TritonCodeResource[]
}

type RenderedContainer = {
  id: string
  name: string
  kind: CodeContainer['kind']
  language: CodeContainer['language']
  artefacts: readonly CodeArtefact[]
  children: readonly RenderedContainer[]
  sourceIds: readonly string[]
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

function containerOverviewSubtitle(container: CodeContainer): string {
  if (container.kind === 'module') {
    return 'module · [packages](triton://diagram/ts-packages?module='
      + encodeURIComponent(container.id)
      + ')'
  }
  return containerSubtitle(container)
}

function containerToModuleOverviewResource(container: CodeContainer): TritonCodeResource {
  return {
    id: container.id,
    name: container.name,
    subtitle: containerOverviewSubtitle(container),
    'x-triton-project-kind': 'module',
  }
}

function containerToResource(
  container: CodeContainer,
  relations: readonly CodeRelation[],
  options: { omitModuleChildren?: boolean } = {},
): TritonCodeResource {
  const childContainers = options.omitModuleChildren
    ? container.children.filter((child) => child.kind !== 'module')
    : container.children
  const children = childContainers.map((child) => containerToResource(child, relations, options))
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
    ...(container.kind === 'module'
      ? { 'x-triton-project-kind': 'module' as const }
      : { 'x-triton-node-type': 'package' }),
    ...(children.length ? { children } : {}),
    ...(children.length && container.kind !== 'module' ? { 'x-triton-package-scope': true as const } : {}),
    ...(innerArtefacts.length ? { 'x-triton-inner-artefacts': innerArtefacts } : {}),
    ...(innerRelations.length ? { 'x-triton-inner-artefact-relations': innerRelations } : {}),
    ...(crossRelations.length ? { 'x-triton-cross-artefact-relations': crossRelations } : {}),
  }
}

function containerToPackageScopeResource(
  container: CodeContainer,
  relations: readonly CodeRelation[],
): TritonCodeResource {
  const childPackages = container.children.filter((child) => child.kind !== 'module')
  const innerPackages = childPackages.map(containerToInnerPackage)
  const innerArtefacts = collectArtefacts(container).map(artefactToInnerArtefact)
  const innerRelations = relations
    .filter((rel) => containerIdInScope(endpointContainerId(rel.from), container.id))
    .filter((rel) => containerIdInScope(endpointContainerId(rel.to), container.id))
    .map(relationToInnerRelation)
    .filter((rel): rel is TritonInnerArtefactRelationSpec => rel !== null)
  const crossRelations = relations
    .filter((rel) => rel.kind !== 'imports')
    .filter((rel) => relationTouchesContainer(rel, container.id))
    .filter((rel) => relationCrossesContainerBoundary(rel, container.id))
    .map(relationToInnerRelation)
    .filter((rel): rel is TritonInnerArtefactRelationSpec => rel !== null)

  return {
    id: container.id,
    name: container.name,
    subtitle: containerSubtitle(container),
    'x-triton-node-type': 'package',
    ...(innerPackages.length ? { 'x-triton-inner-packages': innerPackages } : {}),
    ...(innerArtefacts.length ? { 'x-triton-inner-artefacts': innerArtefacts } : {}),
    ...(innerRelations.length ? { 'x-triton-inner-artefact-relations': innerRelations } : {}),
    ...(crossRelations.length ? { 'x-triton-cross-artefact-relations': crossRelations } : {}),
  }
}

function collectContainerFiles(container: CodeContainer | RenderedContainer, out: Set<string> = new Set()): Set<string> {
  for (const artefact of container.artefacts) out.add(artefact.source.file)
  for (const child of container.children) collectContainerFiles(child, out)
  return out
}

function collapseContainerChain(container: CodeContainer): RenderedContainer {
  let cur = container
  const sourceIds = [cur.id]
  const names = [cur.name]
  while (cur.artefacts.length === 0) {
    const childPackages = cur.children.filter((child) => child.kind !== 'module')
    if (childPackages.length !== 1) break
    cur = childPackages[0]!
    sourceIds.push(cur.id)
    names.push(cur.name)
  }
  return {
    id: cur.id,
    name: names.length > 1 ? names.join('/') : cur.name,
    kind: cur.kind,
    language: cur.language,
    artefacts: cur.artefacts,
    children: cur.children
      .filter((child) => child.kind !== 'module')
      .map(collapseContainerChain),
    sourceIds,
  }
}

function collectRenderedDescendantContainers(container: CodeContainer): RenderedContainer[] {
  const out: RenderedContainer[] = []
  for (const child of container.children) {
    if (child.kind === 'module') continue
    const rendered = collapseContainerChain(child)
    out.push(rendered)
    collectRenderedDescendantContainersFromRendered(rendered, out)
  }
  return out
}

function collectRenderedDescendantContainersFromRendered(
  container: RenderedContainer,
  out: RenderedContainer[],
): void {
  for (const child of container.children) {
    out.push(child)
    collectRenderedDescendantContainersFromRendered(child, out)
  }
}

function renderedEndpointMap(containers: readonly RenderedContainer[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const container of containers) {
    for (const sourceId of container.sourceIds) out.set(sourceId, container.id)
  }
  return out
}

function containerArtefactBreakdown(container: CodeContainer | RenderedContainer): string {
  const files = collectContainerFiles(container)
  const artefacts = container.artefacts
  if (!artefacts.length) {
    return `${files.size} file${files.size === 1 ? '' : 's'}`
  }
  const byKind = new Map<string, number>()
  for (const artefact of artefacts) byKind.set(artefact.kind, (byKind.get(artefact.kind) ?? 0) + 1)
  return [...byKind.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`)
    .join(', ')
}

function containerDirectArtefactLeafResources(container: CodeContainer): TritonCodeResource[] {
  return container.artefacts.map((artefact) => ({
    id: artefact.id,
    name: artefact.name,
    subtitle: artefact.kind,
    'x-triton-node-type': 'artefact',
    'x-triton-declaration': artefact.declaration,
    'x-triton-source-file': artefact.source.file,
    'x-triton-source-row': artefact.source.startRow,
    ...(() => {
      const constructors = memberSignatures(artefact, 'constructor')
      return constructors.length ? { 'x-triton-constructor-signatures': constructors } : {}
    })(),
    ...(() => {
      const methods = [
        ...memberSignatures(artefact, 'method'),
        ...memberSignatures(artefact, 'function'),
      ]
      return methods.length ? { 'x-triton-method-signatures': methods } : {}
    })(),
  }))
}

function renderedContainerToInnerPackage(container: RenderedContainer): TritonInnerPackageSpec {
  const innerPackages = container.children.map(renderedContainerToInnerPackage)
  return {
    id: container.id,
    name: container.name,
    subtitle: container.kind,
    ...(innerPackages.length ? { innerPackages } : {}),
  }
}

function descendantPackageLeafResource(container: RenderedContainer, relations: readonly CodeRelation[]): TritonCodeResource {
  const innerRelations = relations
    .filter((rel) => rel.kind !== 'imports' && relationWithinContainer(rel, container.id))
    .map(relationToInnerRelation)
    .filter((rel): rel is TritonInnerArtefactRelationSpec => rel !== null)
  const crossRelations = relations
    .filter((rel) => rel.kind !== 'imports')
    .filter((rel) => relationTouchesContainer(rel, container.id))
    .filter((rel) => relationCrossesContainerBoundary(rel, container.id))
    .map(relationToInnerRelation)
    .filter((rel): rel is TritonInnerArtefactRelationSpec => rel !== null)
  const innerPackages = container.children.map(renderedContainerToInnerPackage)
  const innerArtefacts = container.artefacts.map(artefactToInnerArtefact)

  return {
    id: container.id,
    name: container.name,
    subtitle: containerArtefactBreakdown(container),
    'x-triton-node-type': 'package',
    ...(innerPackages.length ? { 'x-triton-inner-packages': innerPackages } : {}),
    ...(innerArtefacts.length ? { 'x-triton-inner-artefacts': innerArtefacts } : {}),
    ...(innerRelations.length ? { 'x-triton-inner-artefact-relations': innerRelations } : {}),
    ...(crossRelations.length ? { 'x-triton-cross-artefact-relations': crossRelations } : {}),
  }
}

function containerToScopedPackageGraphResource(
  container: CodeContainer,
  relations: readonly CodeRelation[],
): TritonCodeResource {
  const descendantPackages = collectRenderedDescendantContainers(container)
  const childResources = [
    ...containerDirectArtefactLeafResources(container),
    ...descendantPackages.map((child) => descendantPackageLeafResource(child, relations)),
  ].sort((a, b) => a.id.localeCompare(b.id))
  const files = collectContainerFiles(container)
  const subtitleParts = [
    `${files.size} ${container.language} file${files.size === 1 ? '' : 's'}`,
    ...(descendantPackages.length
      ? [`${descendantPackages.length} nested package${descendantPackages.length === 1 ? '' : 's'}`]
      : []),
    ...(container.artefacts.length
      ? [`${container.artefacts.length} direct artefact${container.artefacts.length === 1 ? '' : 's'}`]
      : []),
  ]

  return {
    id: container.id,
    name: container.name,
    subtitle: subtitleParts.join(' · '),
    'x-triton-package-scope': true,
    'x-triton-package-language': container.language,
    children: childResources,
  }
}

function scopedPackageGraphImportRelations(relations: readonly CodeRelation[], scope: CodeContainer) {
  const descendantPackages = collectRenderedDescendantContainers(scope)
  const endpoints = renderedEndpointMap(descendantPackages)
  const directArtefactIds = new Set(scope.artefacts.map((artefact) => artefact.id))
  const renderedEndpoint = (id: string): string | null => {
    const containerId = endpointContainerId(id)
    if (directArtefactIds.has(id)) return id
    return endpoints.get(containerId) ?? null
  }
  const out: { from: string; to: string; label: string; arrowDirection: 'forward' }[] = []
  const seen = new Set<string>()
  for (const rel of relations) {
    if (rel.kind !== 'imports') continue
    const from = renderedEndpoint(rel.from)
    const to = renderedEndpoint(rel.to)
    if (!from || !to || from === to) continue
    const key = `${from}\u0001${to}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ from, to, label: 'imports', arrowDirection: 'forward' })
  }
  out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  return out
}

function collectProjectGraphResources(
  containers: readonly CodeContainer[],
  relations: readonly CodeRelation[],
  out: TritonCodeResource[] = [],
): TritonCodeResource[] {
  for (const container of containers) {
    out.push(
      container.kind === 'module'
        ? containerToModuleOverviewResource(container)
        : containerToResource(container, relations, { omitModuleChildren: true }),
    )
    collectProjectGraphResources(
      container.children.filter((child) => child.kind === 'module'),
      relations,
      out,
    )
  }
  return out
}

function findContainer(container: CodeContainer, id: string): CodeContainer | null {
  if (container.id === id) return container
  for (const child of container.children) {
    const hit = findContainer(child, id)
    if (hit) return hit
  }
  return null
}

function containerIdInScope(containerId: string, scopeId: string): boolean {
  return containerId === scopeId || containerId.startsWith(`${scopeId}/`)
}

function scopedContainerImportRelations(relations: readonly CodeRelation[], scopeId: string) {
  return containerImportRelations(
    relations.filter((rel) => {
      if (rel.kind !== 'imports') return false
      const from = endpointContainerId(rel.from)
      const to = endpointContainerId(rel.to)
      return containerIdInScope(from, scopeId) && containerIdInScope(to, scopeId)
    }),
  )
}

function moduleContainmentRelations(parentId: string, containers: readonly CodeContainer[]) {
  const out: { from: string; to: string; label: string }[] = []
  for (const container of containers) {
    out.push({ from: parentId, to: container.id, label: 'contains' })
    if (container.kind === 'module') {
      out.push(...moduleContainmentRelations(
        container.id,
        container.children.filter((child) => child.kind === 'module'),
      ))
    }
  }
  return out
}

function collectModuleIds(containers: readonly CodeContainer[], out: string[] = []): string[] {
  for (const container of containers) {
    if (container.kind === 'module') out.push(container.id)
    collectModuleIds(container.children, out)
  }
  return out
}

function owningModuleId(containerId: string, moduleIds: readonly string[]): string | null {
  let best: string | null = null
  for (const moduleId of moduleIds) {
    if (!containerIdInScope(containerId, moduleId)) continue
    if (!best || moduleId.length > best.length) best = moduleId
  }
  return best
}

function moduleImportRelations(containers: readonly CodeContainer[], relations: readonly CodeRelation[]) {
  const moduleIds = collectModuleIds(containers)
  const out: { from: string; to: string; label: string }[] = []
  const seen = new Set<string>()
  for (const rel of relations) {
    if (rel.kind !== 'imports') continue
    const from = owningModuleId(endpointContainerId(rel.from), moduleIds)
    const to = owningModuleId(endpointContainerId(rel.to), moduleIds)
    if (!from || !to || from === to) continue
    const key = `${from}\u0001${to}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ from, to, label: 'imports' })
  }
  return out
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
  const scopeContainerId = options.scopeContainerId?.trim()
  if (scopeContainerId) {
    const scope = findContainer(model.root, scopeContainerId)
    if (scope) {
      const childPackages = collectRenderedDescendantContainers(scope)
      if (childPackages.length) {
        return {
          description: options.description ?? `Code model projection for ${model.name}.`,
          resources: [containerToScopedPackageGraphResource(scope, model.relations)],
          perspectives: [
            {
              name: 'package imports',
              orientation: 'leftToRight',
              color: 'royalblue',
              relations: scopedPackageGraphImportRelations(model.relations, scope),
            },
          ],
        }
      }
      return {
        description: options.description ?? `Code model projection for ${model.name}.`,
        resources: [containerToPackageScopeResource(scope, model.relations)],
        perspectives: [
          {
            name: 'dependencies',
            orientation: 'leftToRight',
            relations: scopedContainerImportRelations(model.relations, scope.id),
          },
        ],
      }
    }
  }

  const rootAsProject = options.rootResourceKind === 'project'
  const children = rootAsProject
    ? []
    : model.root.children.map((container) => containerToResource(container, model.relations))
  const resources = rootAsProject
    ? [
        {
          id: options.resourceId ?? model.id,
          name: model.name,
          subtitle: 'project',
          description: options.description ?? `Code model projection for ${model.name}.`,
          'x-triton-project-kind': 'project' as const,
        },
        ...collectProjectGraphResources(model.root.children, model.relations),
      ]
    : undefined
  const rootResource: TritonCodeResource = {
    id: options.resourceId ?? model.id,
    name: model.name,
    subtitle: rootAsProject ? 'project' : `${model.language} project`,
    description: options.description ?? `Code model projection for ${model.name}.`,
    ...(rootAsProject
      ? { 'x-triton-project-kind': 'project' as const }
      : {
          'x-triton-package-scope': true as const,
          'x-triton-package-language': model.language,
        }),
    ...(children.length ? { children } : {}),
  }

  return {
    description: options.description ?? `Code model projection for ${model.name}.`,
    resources: resources ?? [rootResource],
    perspectives: [
      {
        name: 'dependencies',
        orientation: 'leftToRight',
        relations: [
          ...(rootAsProject
            ? moduleContainmentRelations(options.resourceId ?? model.id, model.root.children)
            : []),
          ...(rootAsProject
            ? moduleImportRelations(model.root.children, model.relations)
            : containerImportRelations(model.relations)),
        ],
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

