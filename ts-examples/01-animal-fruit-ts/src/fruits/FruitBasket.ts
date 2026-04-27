import type { Fruit, FruitKind } from './Fruit'

/**
 * A small collection abstraction so functions can accept and return richer fruit types.
 */
export interface FruitBasket {
  label: string
  fruits: Fruit[]
  preferredKinds: FruitKind[]
  totalCalories(): number
}

/**
 * Pick the first fruit matching a preferred kind.
 */
export function selectPreferredFruit(basket: FruitBasket): Fruit | undefined {
  return basket.fruits.find((fruit) => basket.preferredKinds.includes(fruit.kind))
}
