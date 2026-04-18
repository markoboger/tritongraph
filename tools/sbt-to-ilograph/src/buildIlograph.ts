import type { IlographDocument, IlographRelation, IlographResource } from './ilographTypes.js'

export function sbtProjectsToIlograph(
  projects: import('./parseBuildSbt.js').SbtSubproject[],
  meta: { title?: string; sourcePath?: string } = {},
): IlographDocument {
  const ids = new Set(projects.map((p) => p.id))
  const resources: IlographResource[] = projects.map((p) => ({
    name: p.id,
    ...(p.baseDir ? { subtitle: p.baseDir } : {}),
  }))

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
