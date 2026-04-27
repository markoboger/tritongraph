import type { Animal } from '../animals/Animal'
import type { Fruit, FruitKind } from '../fruits/Fruit'
import type { FruitBasket } from '../fruits/FruitBasket'

/**
 * Feeding windows model time-based diet constraints without pulling in dates.
 */
export type FeedingWindow = 'morning' | 'afternoon' | 'evening'

/**
 * A diet links animals to fruits and makes cross-folder dependencies explicit.
 */
export interface DietPlan {
  animal: Animal
  rewards: Fruit[]
  forbiddenKinds: FruitKind[]
  windows: FeedingWindow[]
}

/**
 * Converts a basket into a diet plan for one animal.
 */
export function buildDietPlan(animal: Animal, basket: FruitBasket): DietPlan {
  return {
    animal,
    rewards: basket.fruits,
    forbiddenKinds: [],
    windows: ['morning', 'evening'],
  }
}

/**
 * Summarise the calories available in the plan.
 */
export function estimateDailyCalories(plan: DietPlan): number {
  return plan.rewards.reduce((sum, fruit) => sum + fruit.calories, 0)
}
