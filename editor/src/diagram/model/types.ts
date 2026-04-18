/**
 * Domain model for the diagram editor (containers → layers → sections → boxes).
 * Vue Flow still owns node positions; each flow “module” node is a graph node whose box is a {@link ProjectBoxModel}.
 */

export type BoxKind = 'project'

/** Stable id for a box instance (currently the Vue Flow node id). */
export type BoxId = string

/** Dependency column within a container (classpath depth for root). */
export type LayerDepth = number

/** One vertical slot in a layer; today at most one box per section. */
export interface DiagramSectionModel {
  id: string
  layerDepth: LayerDepth
  /** Stack order within the layer (0 = top). */
  indexInLayer: number
  /** Vue Flow node id hosting this section’s box. */
  graphNodeId: BoxId
  box: ProjectBoxModel
}

export interface DiagramLayerModel {
  depth: LayerDepth
  sections: DiagramSectionModel[]
  /**
   * Sections whose box is pinned. Product direction: at most one pin per layer; today the editor
   * may still allow more until validation is tightened.
   */
  pinnedSectionIds: string[]
  /** Section id of the layer-drill focused box, if any (only one focused box per container). */
  focusedSectionId: string | null
}

/** A layout region: root viewport today; nested groups become child containers later. */
export interface DiagramContainer {
  id: string
  parentContainerId: string | undefined
  /** Viewport / inner bounds in screen flow space (root fills viewport). */
  bounds: { x: number; y: number; width: number; height: number }
  layers: DiagramLayerModel[]
}

/** Injected at the diagram root; combines the container tree with flow ids for edges. */
export interface DiagramRootModel {
  container: DiagramContainer
  /** All Vue Flow node ids that host a project box at the root container. */
  projectGraphNodeIds: string[]
}

export interface ProjectBoxModel {
  kind: 'project'
  id: BoxId
  label: string
  subtitle?: string
  /** Shown only while the box is focused (layer drill). */
  notes?: string
  language?: string
  accentColor?: string
  pinned: boolean
  /** Layer drill: this box is the focused one in its layer. */
  focused: boolean
}
