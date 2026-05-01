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
    title: '01 — Single service (web + Dockerfile)',
    subtitle: 'Compose builds ./Dockerfile, tags docker-examples-01-web:local, publishes 18080→80',
    icon: 'service',
  },
  {
    slug: '02-build-context',
    title: '02 — Build context (api + Dockerfile)',
    subtitle: 'Root Dockerfile + build.context . → image docker-examples-02-api:local',
    icon: 'project',
  },
  {
    slug: '03-network-dependencies',
    title: '03 — Network and depends_on',
    subtitle: 'Per-service Dockerfiles under api/ and worker/, shared network internal',
    icon: 'network',
  },
  {
    slug: '04-stack-db-volumes',
    title: '04 — Stack: DB, volumes, network, port',
    subtitle: 'app/ + db/ Dockerfiles, named volumes, app-net, depends_on, host port on app',
    icon: 'database',
  },
  {
    slug: '05-healthcheck',
    title: '05 — Compose healthcheck',
    subtitle: 'Same web+Dockerfile pattern with a service healthcheck and extra port 18083',
    icon: 'service',
  },
  {
    slug: '06-scala-services',
    title: '06 — Two Scala services (Compose + sbt)',
    subtitle: 'api + worker images, root build.sbt; diagram links open sbt, packages, and inner package views',
    icon: 'project',
  },
]
