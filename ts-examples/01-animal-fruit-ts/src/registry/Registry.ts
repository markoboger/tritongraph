import type { Fruit } from '../fruits/Fruit'
import type { Animal } from '../animals/Animal'

/**
 * A small “typed bag” used to show cross-folder `gets` relations.
 */
export interface Registry {
  animals: Animal[]
  fruits: Fruit[]
}

/**
 * Small factory function so we have a `function` artefact in the `registry` folder.
 */
export function createEmptyRegistry(): Registry {
  return { animals: [], fruits: [] }
}

