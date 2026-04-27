import type { Pet } from './Pet'
import type { Fruit } from '../fruits/Fruit'

/**
 * Concrete `Pet` implementation.
 *
 * Demonstrates:
 * - `implements` (class → interface)
 * - a real constructor signature
 * - two functions we can list in the diagram (`speak`, `likes`)
 */
export class Dog implements Pet {
  kind: 'animal' = 'animal'
  name: string
  owner: string

  constructor(name: string, owner: string) {
    this.name = name
    this.owner = owner
  }

  speak(): string {
    return `woof, I'm ${this.name}`
  }

  likes(_fruit: Fruit): boolean {
    return true
  }
}

