import { Cat } from '../animals/Cat'
import { Dog } from '../animals/Dog'
import type { Fruit } from '../fruits/Fruit'
import { Apple } from '../fruits/Apple'
import { Banana } from '../fruits/Banana'
import type { Animal } from '../animals/Animal'
import type { Caretaker } from '../caretakers/Caretaker'
import { Keeper } from '../caretakers/Caretaker'
import type { Habitat } from '../habitats/Habitat'
import { Kennel } from '../habitats/Habitat'
import type { DietPlan } from '../nutrition/DietPlan'
import { buildDietPlan } from '../nutrition/DietPlan'
import type { FruitBasket } from '../fruits/FruitBasket'

/**
 * A small typed world used to show cross-folder relations.
 */
export interface Registry {
  animals: Animal[]
  fruits: Fruit[]
  habitats: Habitat[]
  caretakers: Caretaker[]
  diets: DietPlan[]
}

/**
 * Small factory function so we have a `function` artefact in the `registry` folder.
 */
export function createEmptyRegistry(): Registry {
  return { animals: [], fruits: [], habitats: [], caretakers: [], diets: [] }
}

/**
 * Build a richer registry with several concrete classes and related plans.
 */
export function createDemoRegistry(): Registry {
  const animals = [new Dog('Triton', 'Marko'), new Cat('Nori', 'Ava')]
  const fruits = [new Apple(), new Banana()]
  const habitats = [new Kennel('north kennel', animals)]
  const caretakers = [new Keeper('Sam')]
  const basket: FruitBasket = {
    label: 'starter basket',
    fruits,
    preferredKinds: ['apple', 'banana'],
    totalCalories: () => fruits.reduce((sum, fruit) => sum + fruit.calories, 0),
  }
  const diets = animals.map((animal) => buildDietPlan(animal, basket))
  return { animals, fruits, habitats, caretakers, diets }
}

