import type { Pet } from './Pet'
import type { Fruit } from '../fruits/Fruit'
import type { DietPlan } from '../nutrition/DietPlan'

/**
 * Another concrete pet implementation with a diet-aware method.
 */
export class Cat implements Pet {
  kind: 'animal' = 'animal'
  name: string
  owner: string
  napsPerDay: number

  constructor(name: string, owner: string, napsPerDay = 6) {
    this.name = name
    this.owner = owner
    this.napsPerDay = napsPerDay
  }

  speak(): string {
    return `meow, I'm ${this.name}`
  }

  prefers(fruit: Fruit, plan: DietPlan): boolean {
    return plan.rewards.some((reward) => reward.kind === fruit.kind)
  }
}
