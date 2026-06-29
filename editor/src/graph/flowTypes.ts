import type { Edge, Node } from '@vue-flow/core'
import type { BoxCompartment } from '../diagram/boxCompartments'
import type {
  TritonInnerArtefactRelationSpec,
  TritonInnerArtefactSpec,
  TritonInnerPackageSpec,
  TritonMethodSignature,
} from '../ilograph/types'
import type { NamedBoxColor } from './boxColors'

/** Data payload for every node produced by ilographDocumentToFlow and enriched by applyOverlayToFlowNodes. */
export interface TritonNodeData {
  label: string
  subtitle: string
  description: string
  declaration?: string
  constructorParams?: string
  constructorSignatures?: readonly TritonMethodSignature[]
  methodSignatures?: readonly TritonMethodSignature[]
  sourceFile?: string
  sourceRow?: number
  sourceEndRow?: number
  boxColor?: NamedBoxColor
  pinned?: boolean
  iconUrl?: string
  tritonIconKey?: string
  language?: string
  drillNote?: string
  innerPackages?: readonly TritonInnerPackageSpec[]
  innerArtefacts?: readonly TritonInnerArtefactSpec[]
  innerArtefactRelations?: readonly TritonInnerArtefactRelationSpec[]
  crossArtefactRelations?: readonly TritonInnerArtefactRelationSpec[]
  projectCompartments?: BoxCompartment[]
  preferredFocusWidth?: number
  contentWeight?: number
  preferredLeafHeight?: number
  projectKind?: 'project' | 'module' | 'general'
  tritonLayoutFrozen?: boolean
  packageScope?: boolean
  // Fields written by applyOverlayToFlowNodes after the initial conversion
  scannerDescription?: string
  notes?: string
  innerArtefactPinned?: Record<string, boolean>
  innerArtefactColors?: Record<string, string>
}

export type TritonFlowNode = Node<TritonNodeData>
export type TritonFlowEdge = Edge
