import type { InjectionKey, Ref } from 'vue'

/**
 * The component a conformance finding is about, while the diagram shows that finding. Provided by
 * GraphWorkspace; a tile marks itself when the component lies inside it.
 */
export const findingComponentKey = Symbol('tritonFindingComponent') as InjectionKey<Ref<string | null>>

/** True when `componentId` is `tileId` itself or lies inside it (`a.b` contains `a.b.c`, not `a.bc`). */
export function componentIsInside(componentId: string, tileId: string): boolean {
  return componentId === tileId || componentId.startsWith(`${tileId}.`) || componentId.startsWith(`${tileId}/`)
}
