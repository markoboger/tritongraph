import {
  SCALA_CREATES_STROKE,
  SCALA_EXTENDS_STROKE,
  SCALA_GETS_STROKE,
  SCALA_HAS_TRAIT_STROKE,
  TS_IMPORTS_STROKE,
  TS_IMPLEMENTS_STROKE,
  TS_RETURNS_STROKE,
} from '../../graph/relationKinds'

export type InnerRelationKind = 'extends' | 'with' | 'implements' | 'returns' | 'imports' | 'gets' | 'creates'

export type BridgeRelation = {
  from: string
  to: string
  label: string
  wrapperName?: string
}

export type PortEndpoint = {
  id: string
  side: 'left' | 'right'
}

export type RoutedInnerRelation = {
  from: string
  to: string
  label: string
  wrapperName?: string
  displayLabel?: string
  overlay?: boolean
}

export type InnerEdgeDraw = {
  id: string
  path: string
  labelX: number
  labelY: number
  relationLabel: string
  displayLabel: string
  kind: InnerRelationKind
  stroke: string
  from: string
  to: string
  overlay: boolean
}

export type BoundaryStubRelation = {
  externalId: string
  externalLabel: string
  foreignArtefactId: string
  foreignPackageId: string
  localId: string
  side: 'left' | 'right'
  label: string
  wrapperName?: string
}

export function artefactPackageId(artefactId: string): string {
  const sep = artefactId.indexOf('::')
  return sep >= 0 ? artefactId.slice(0, sep) : ''
}

export function artefactSimpleName(artefactId: string): string {
  const sep = artefactId.lastIndexOf(':')
  return sep >= 0 ? artefactId.slice(sep + 1) : artefactId
}

export function innerArtefactRelationStroke(label: string): { kind: InnerRelationKind; stroke: string } {
  if (label === 'with') return { kind: 'with', stroke: SCALA_HAS_TRAIT_STROKE }
  if (label === 'implements') return { kind: 'implements', stroke: TS_IMPLEMENTS_STROKE }
  if (label === 'returns') return { kind: 'returns', stroke: TS_RETURNS_STROKE }
  if (label === 'imports') return { kind: 'imports', stroke: TS_IMPORTS_STROKE }
  if (label === 'gets') return { kind: 'gets', stroke: SCALA_GETS_STROKE }
  if (label === 'creates') return { kind: 'creates', stroke: SCALA_CREATES_STROKE }
  return { kind: 'extends', stroke: SCALA_EXTENDS_STROKE }
}

export function innerArtefactEdgeDisplayLabel(kind: InnerRelationKind, wrapperName?: string): string {
  if (kind === 'with') return 'has trait'
  if (kind === 'implements') return 'implements'
  if (kind === 'returns') return 'returns'
  if (kind === 'imports') return 'imports'
  if (kind === 'gets') return wrapperName ? `gets as ${wrapperName}` : 'gets'
  if (kind === 'creates') return 'creates'
  return 'extends'
}

export function innerEdgeMarkerSuffix(kind: InnerRelationKind): string {
  if (kind === 'with') return 'hastrait'
  if (kind === 'implements') return 'implements'
  if (kind === 'returns') return 'returns'
  if (kind === 'imports') return 'imports'
  if (kind === 'gets') return 'gets'
  if (kind === 'creates') return 'creates'
  return 'extends'
}

export function childPackagePortId(packageId: string, side: 'left' | 'right'): string {
  return `__port:child:${side}:${packageId}`
}

export function rootPackagePortId(boxId: string, side: 'left' | 'right'): string {
  return `__port:root:${side}:${boxId}`
}
