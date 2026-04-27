/** Discriminated union used by `Fruit.kind`. */
export type FruitKind = 'apple' | 'banana'

/**
 * Minimal fruit model for the example.
 *
 * Real code would likely have more structure; we keep it tiny so relations stay readable.
 */
export interface Fruit {
  kind: FruitKind
  calories: number
}

