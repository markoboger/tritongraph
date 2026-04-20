import type { IlographDocument, IlographRelation, IlographResource } from './ilographTypes'
import type { SbtSubproject } from './parseBuildSbt'

export interface SbtToIlographMeta {
  title?: string
  sourcePath?: string
  /**
   * Subprojects that contain `.scala` sources. Each entry gets a markdown link in its subtitle:
   * `[packages](triton:packages)` — consumers that understand the `triton:` scheme can route it
   * to a package-graph view. Other consumers can ignore the link or strip it.
   */
  projectsWithScalaSources?: ReadonlySet<string>
}

const PACKAGES_LINK_MD = '[packages](triton:packages)'

function makeSubtitle(p: SbtSubproject, meta: SbtToIlographMeta): string | undefined {
  const parts: string[] = []
  if (p.baseDir && p.baseDir !== '.') parts.push(p.baseDir)
  if (meta.projectsWithScalaSources?.has(p.id)) parts.push(PACKAGES_LINK_MD)
  return parts.length ? parts.join(' · ') : undefined
}

export function sbtProjectsToIlographDocument(
  projects: SbtSubproject[],
  meta: SbtToIlographMeta = {},
): IlographDocument {
  const ids = new Set(projects.map((p) => p.id))
  const resources: IlographResource[] = projects.map((p) => {
    const subtitle = makeSubtitle(p, meta)
    return {
      name: p.id,
      ...(subtitle ? { subtitle } : {}),
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
