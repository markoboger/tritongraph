import type { Animal } from './Animal'

/**
 * A `Pet` is an `Animal` owned by someone.
 *
 * In TypeScript this is expressed as `extends` (interface inheritance).
 */
export interface Pet extends Animal {
  owner: string
}

