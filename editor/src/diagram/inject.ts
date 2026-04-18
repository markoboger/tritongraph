import type { ComputedRef, InjectionKey } from 'vue'
import type { DiagramRootModel } from './model/types'

/** Provided by {@link DiagramContainerView} for descendants (e.g. future tooling). */
export const diagramRootModelKey: InjectionKey<ComputedRef<DiagramRootModel>> = Symbol('diagramRootModel')
