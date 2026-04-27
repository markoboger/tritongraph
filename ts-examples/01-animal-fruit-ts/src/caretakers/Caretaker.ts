import type { AnimalProfile } from '../animals/AnimalProfile'
import type { Pet } from '../animals/Pet'
import type { Habitat } from '../habitats/Habitat'
import type { DietPlan } from '../nutrition/DietPlan'

/**
 * A caretaker coordinates pets, habitats, and diets.
 */
export interface Caretaker {
  name: string
  assign(pet: Pet, habitat: Habitat): AnimalProfile
  feed(profile: AnimalProfile, plan: DietPlan): void
}

/**
 * Default caretaker implementation used by the registry package.
 */
export class Keeper implements Caretaker {
  name: string

  constructor(name: string) {
    this.name = name
  }

  assign(pet: Pet, habitat: Habitat): AnimalProfile {
    return {
      animal: pet,
      habitat,
      diet: {
        animal: pet,
        rewards: [],
        forbiddenKinds: [],
        windows: ['morning'],
      },
    }
  }

  feed(_profile: AnimalProfile, _plan: DietPlan): void {
    // This example keeps behavior small; the type graph is the interesting part.
  }
}
