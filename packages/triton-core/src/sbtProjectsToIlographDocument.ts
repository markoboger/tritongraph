import type {
  IlographDocument,
  IlographRelation,
  IlographResource,
  TritonProjectCompartment,
} from './ilographTypes'
import type { SbtSubproject } from './parseBuildSbt'

export interface SbtToIlographMeta {
  title?: string
  sourcePath?: string
  /**
   * Subprojects that contain `.scala` sources. Each entry gets a markdown link in its subtitle:
   * `[packages](triton://diagram/packages?project=<id>)` — consumers that understand the
   * `triton:` scheme can route it to a project-scoped package-graph view. Other consumers can
   * ignore the link or strip it.
   */
  projectsWithScalaSources?: ReadonlySet<string>
}

function pickRootProjectId(projects: ReadonlyArray<SbtSubproject>): string | undefined {
  if (!projects.length) return undefined
  const dotRoots = projects.filter((p) => (p.baseDir ?? '').trim() === '.')
  if (dotRoots.length === 1) return dotRoots[0]?.id
  if (projects.length === 1) return projects[0]?.id

  const incoming = new Set<string>()
  for (const p of projects) {
    for (const id of p.aggregate) incoming.add(id)
  }
  const aggregateRoots = projects.filter((p) => p.aggregate.length > 0 && !incoming.has(p.id))
  if (aggregateRoots.length === 1) return aggregateRoots[0]?.id
  return projects[0]?.id
}

function packagesLinkMarkdown(projectId: string): string {
  return `[packages](triton://diagram/packages?project=${encodeURIComponent(projectId)})`
}

function makeSubtitle(p: SbtSubproject, meta: SbtToIlographMeta): string | undefined {
  const parts: string[] = []
  if (p.baseDir && p.baseDir !== '.') parts.push(p.baseDir)
  if (meta.projectsWithScalaSources?.has(p.id)) parts.push(packagesLinkMarkdown(p.id))
  return parts.length ? parts.join(' · ') : undefined
}

function buildProjectCompartments(
  p: SbtSubproject,
  kind: 'project' | 'module',
): TritonProjectCompartment[] {
  const versionsRows = [
    ...(p.scalaVersion ? [{ label: 'Scala', value: p.scalaVersion }] : []),
    ...(p.version ? [{ label: 'Version', value: p.version }] : []),
  ]
  const libraryRows = p.libraryDependencies.map((value) => ({ value }))
  const settingsRows = [
    { label: 'Kind', value: kind === 'project' ? 'Project' : 'Module' },
    { label: kind === 'project' ? 'Project id' : 'Module id', value: p.id },
    ...(p.name ? [{ label: 'Name', value: p.name }] : []),
    ...(p.organization ? [{ label: 'Organization', value: p.organization }] : []),
    { label: 'Base dir', value: p.baseDir && p.baseDir.trim() ? p.baseDir : '.' },
    ...(p.dependsOn.length ? [{ label: 'Depends on', value: p.dependsOn.join(', ') }] : []),
    ...(p.aggregate.length ? [{ label: 'Aggregates', value: p.aggregate.join(', ') }] : []),
  ]
  return [
    {
      id: 'versions',
      title: 'Versions',
      rows: versionsRows,
      emptyText: 'No version metadata',
    },
    {
      id: 'libraries',
      title: 'Libraries',
      rows: libraryRows,
      emptyText: 'No library dependencies',
    },
    {
      id: 'settings',
      title: 'Settings',
      rows: settingsRows,
      emptyText: 'No settings',
    },
  ]
}

export function sbtProjectsToIlographDocument(
  projects: SbtSubproject[],
  meta: SbtToIlographMeta = {},
): IlographDocument {
  const ids = new Set(projects.map((p) => p.id))
  const rootProjectId = pickRootProjectId(projects)
  const resources: IlographResource[] = projects.map((p) => {
    const subtitle = makeSubtitle(p, meta)
    const kind: 'project' | 'module' = p.id === rootProjectId ? 'project' : 'module'
    return {
      name: p.id,
      ...(subtitle ? { subtitle } : {}),
      'x-triton-project-kind': kind,
      'x-triton-project-compartments': buildProjectCompartments(p, kind),
    }
  })

  const relations: IlographRelation[] = []
  for (const p of projects) {
    for (const to of p.dependsOn) {
      if (!ids.has(to)) continue
      relations.push({ from: p.id, to, label: 'depends on' })
    }
    for (const to of p.aggregate) {
      if (!ids.has(to)) continue
      relations.push({ from: p.id, to, label: 'aggregates' })
    }
  }

  const descParts: string[] = []
  if (meta.title) descParts.push(meta.title)
  if (meta.sourcePath) descParts.push(`Source: \`${meta.sourcePath}\``)

  return {
    ...(descParts.length ? { description: descParts.join('\n') } : {}),
    resources,
    perspectives: [
      {
        name: 'dependencies',
        orientation: 'leftToRight',
        color: 'royalblue',
        relations,
      },
    ],
  }
}
