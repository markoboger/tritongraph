import type { DockerConceptIconKey } from './dockerConceptIcons'

/** Slug = folder under repo `docker-examples/` (served at `/docker-examples/<slug>/…`). */
export type DockerDiagramExample = {
  slug: string
  title: string
  subtitle: string
  /** Glyph on the Triton starter card. */
  icon: DockerConceptIconKey
}

export const dockerDiagramExamples: readonly DockerDiagramExample[] = [
  {
    slug: '01-single-service',
    title: 'Single service',
    subtitle: 'Registry image → service → container + port',
    icon: 'container',
  },
  {
    slug: '02-build-context',
    title: 'Build context',
    subtitle: 'Project → Dockerfile build → image → service → container',
    icon: 'project',
  },
  {
    slug: '03-network-dependencies',
    title: 'Network and depends_on',
    subtitle: 'Shared image, internal network, worker depends on api',
    icon: 'network',
  },
  {
    slug: '04-stack-db-volumes',
    title: 'Stack with database and volumes',
    subtitle: 'App + Postgres, named volumes, port, shared network',
    icon: 'database',
  },
]
