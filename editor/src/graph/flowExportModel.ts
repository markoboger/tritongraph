/** Narrow shapes so export code does not pull in Vue Flow's deep generics. */

export type ExportFlowNode = {
  id: string
  type?: string
  position: { x: number; y: number }
  data?: Record<string, unknown>
  parentNode?: string
  style?: Record<string, unknown>
}

export type ExportFlowEdge = {
  id: string
  source: string
  target: string
  label?: string
  markerStart?: unknown
  markerEnd?: unknown
}
