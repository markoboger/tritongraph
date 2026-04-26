import {
  SCALA_CREATES_STROKE,
  SCALA_EXTENDS_STROKE,
  SCALA_GETS_STROKE,
  SCALA_HAS_TRAIT_STROKE,
} from '../../graph/relationKinds'

export type InnerRelationKind = 'extends' | 'with' | 'gets' | 'creates'

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
  if (label === 'gets') return { kind: 'gets', stroke: SCALA_GETS_STROKE }
  if (label === 'creates') return { kind: 'creates', stroke: SCALA_CREATES_STROKE }
  return { kind: 'extends', stroke: SCALA_EXTENDS_STROKE }
}

export function innerArtefactEdgeDisplayLabel(kind: InnerRelationKind, wrapperName?: string): string {
  if (kind === 'with') return 'has trait'
  if (kind === 'gets') return wrapperName ? `gets as ${wrapperName}` : 'gets'
  if (kind === 'creates') return 'creates'
  return 'extends'
}

export function innerEdgeMarkerSuffix(kind: InnerRelationKind): string {
  if (kind === 'with') return 'hastrait'
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
