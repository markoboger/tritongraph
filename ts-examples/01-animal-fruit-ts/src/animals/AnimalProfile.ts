import type { Animal } from './Animal'
import type { Habitat } from '../habitats/Habitat'
import type { DietPlan } from '../nutrition/DietPlan'

/**
 * Aggregates the main cross-package concepts for one animal.
 */
export interface AnimalProfile {
  animal: Animal
  habitat: Habitat
  diet: DietPlan
}

/**
 * Create a profile from its already-resolved collaborators.
 */
export function createAnimalProfile(animal: Animal, habitat: Habitat, diet: DietPlan): AnimalProfile {
  return { animal, habitat, diet }
}
