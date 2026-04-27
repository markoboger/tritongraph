export type { Animal } from './animals/Animal'
export { createAnimalProfile, type AnimalProfile } from './animals/AnimalProfile'
export { Cat } from './animals/Cat'
export type { Pet } from './animals/Pet'
export { Dog } from './animals/Dog'

export type { Fruit, FruitKind } from './fruits/Fruit'
export { Apple } from './fruits/Apple'
export { Banana } from './fruits/Banana'
export { selectPreferredFruit, type FruitBasket } from './fruits/FruitBasket'

export { Keeper, type Caretaker } from './caretakers/Caretaker'
export { Kennel, type Habitat, type HabitatKind } from './habitats/Habitat'
export {
  buildDietPlan,
  estimateDailyCalories,
  type DietPlan,
  type FeedingWindow,
} from './nutrition/DietPlan'
export { createDemoRegistry, createEmptyRegistry, type Registry } from './registry/Registry'

