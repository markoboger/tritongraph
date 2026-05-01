import type { DockerConceptIconKey } from './dockerConceptIcons'

/** Bundled example / dojo entry shown as a card on the Triton home screen. */
export type StarterCardKind = 'dojo' | 'yaml' | 'sbt' | 'ts' | 'docker'

export type StarterCard = {
  kind: StarterCardKind
  /** Argument to {@link selectExample} (`__builtin__`, `dojo:…`, `sbt:…`, `ts:…`, `docker:…`). */
  selectionId: string
  title: string
  /** Secondary line (path, short description). */
  subtitle?: string
  /** Human-readable collection, e.g. "sbt tutorial", "Dojo". */
  group?: string
  /** When `kind === 'docker'`, which concept glyph to show on the card. */
  dockerConceptIcon?: DockerConceptIconKey
}
