import type { Fruit } from './Fruit'

/**
 * A concrete `Fruit` with a default constructor parameter.
 *
 * This is here mainly to demonstrate a constructor signature in TypeScript.
 */
export class Apple implements Fruit {
  kind: 'apple' = 'apple'
  calories: number
  sweetness: number

  constructor(calories = 95, sweetness = 7) {
    this.calories = calories
    this.sweetness = sweetness
  }
}

