/**
 * SVG marks for Docker / Compose graph concepts (Triton docker-examples and future diagram UI).
 * Per-node icons live under `src/assets/language-icons/docker-*.svg`.
 * The top path bar uses {@link dockerBrandIconUrl} (raster from `docker-icon.webp` embedded in SVG).
 */
import containerUrl from '../assets/language-icons/docker-container.svg?url'
import databaseUrl from '../assets/language-icons/docker-database.svg?url'
import imageUrl from '../assets/language-icons/docker-image.svg?url'
import networkUrl from '../assets/language-icons/docker-network.svg?url'
import projectUrl from '../assets/language-icons/docker-project.svg?url'
import serviceUrl from '../assets/language-icons/docker-service.svg?url'
import volumeUrl from '../assets/language-icons/docker-volume.svg?url'
import dockerBrandIconUrl from '../assets/language-icons/docker-icon.svg?url'

export { dockerBrandIconUrl }

export const dockerConceptIcons = {
  image: imageUrl,
  container: containerUrl,
  service: serviceUrl,
  database: databaseUrl,
  network: networkUrl,
  volume: volumeUrl,
  project: projectUrl,
} as const

export type DockerConceptIconKey = keyof typeof dockerConceptIcons

export function dockerConceptIconUrl(key: string): string {
  const k = key.trim()
  if (isDockerConceptIconKey(k)) return dockerConceptIcons[k]
  return dockerConceptIcons.image
}

export function isDockerConceptIconKey(s: string): s is DockerConceptIconKey {
  return Object.prototype.hasOwnProperty.call(dockerConceptIcons, s)
}
