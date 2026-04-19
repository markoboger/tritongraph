import type { IlographDocument, IlographRelation, IlographResource } from '../ilograph/types'
import type { SbtSubproject } from './parseBuildSbt'

/**
 * Same mapping as `tools/sbt-to-ilograph` CLI: subprojects → Ilograph resources + relations.
 * `aggregates` label matches the CLI and is treated like aggregate for styling / layout.
 */
export interface SbtToIlographMeta {
  title?: string
  sourcePath?: string
  /**
   * Subprojects that contain `.scala` sources. Each entry gets a markdown link in its subtitle:
   * `[packages](triton:packages)` — the editor handles `triton:` URLs to switch to the
   * package-graph tab. Pass the project ids (the `lazy val` name from `build.sbt`).
   */
  projectsWithScalaSources?: ReadonlySet<string>
}

const PACKAGES_LINK_MD = '[packages](triton:packages)'

function makeSubtitle(p: SbtSubproject, meta: SbtToIlographMeta): string | undefined {
  const parts: string[] = []
  /** `.` means "project at the root" (`project in file(".")`); showing a literal "." is noise. */
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

  const descParts = [
    meta.title ?? 'sbt multi-project graph (heuristic parse → Ilograph YAML).',
    '**from** = dependent module, **to** = depended-on module (`dependsOn`) or aggregated child (`aggregate`).',
    'See https://ilograph.com/docs/spec',
  ]
  if (meta.sourcePath) descParts.push(`Source: \`${meta.sourcePath}\``)

  return {
    description: descParts.join('\n'),
    resources,
    perspectives: [
      {
        name: 'dependencies',
        orientation: 'leftToRight',
        color: 'royalblue',
        notes:
          'Relations from sbt `.dependsOn` / `.aggregate` (subset parser; not a full Scala AST).',
        relations,
      },
    ],
  }
}
