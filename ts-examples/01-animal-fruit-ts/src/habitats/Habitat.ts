import type { Animal } from '../animals/Animal'

/**
 * Habitat categories used to group animals.
 */
export type HabitatKind = 'home' | 'kennel' | 'orchard' | 'garden'

/**
 * A place that can host animals.
 */
export interface Habitat {
  kind: HabitatKind
  name: string
  residents: Animal[]
  accepts(animal: Animal): boolean
}

/**
 * A concrete habitat implementation for pets.
 */
export class Kennel implements Habitat {
  kind: 'kennel' = 'kennel'
  name: string
  residents: Animal[]

  constructor(name: string, residents: Animal[] = []) {
    this.name = name
    this.residents = residents
  }

  accepts(animal: Animal): boolean {
    return animal.kind === 'animal'
  }
}
