import type { Fruit } from './Fruit'

/**
 * A softer fruit used by animals with gentle diets.
 */
export class Banana implements Fruit {
  kind: 'banana' = 'banana'
  calories: number
  sweetness: number

  constructor(calories = 105, sweetness = 8) {
    this.calories = calories
    this.sweetness = sweetness
  }
}
