/**
 * SVG marks for Docker / Compose graph concepts (Triton docker-examples and future diagram UI).
 * Icons live under `src/assets/language-icons/docker-*.svg` — original artwork, not third-party marks.
 */
import containerUrl from '../assets/language-icons/docker-container.svg'
import databaseUrl from '../assets/language-icons/docker-database.svg'
import imageUrl from '../assets/language-icons/docker-image.svg'
import networkUrl from '../assets/language-icons/docker-network.svg'
import projectUrl from '../assets/language-icons/docker-project.svg'
import serviceUrl from '../assets/language-icons/docker-service.svg'
import volumeUrl from '../assets/language-icons/docker-volume.svg'

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

export function dockerConceptIconUrl(key: DockerConceptIconKey): string {
  return dockerConceptIcons[key]
}
