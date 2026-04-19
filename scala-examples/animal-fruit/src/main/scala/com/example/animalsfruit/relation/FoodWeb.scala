package com.example.animalsfruit.relation

import com.example.animalsfruit.animal.Animal
import com.example.animalsfruit.fruit.{Fruit, Produce, Ripeness}

/** A single observed feeding (case class for parser coverage). */
final case class MealRecord(
    eaterCommonName: String,
    food: Produce,
    notes: Option[String] = None,
)

/**
 * Declarative edges: who (animal display id) eats which food token.
 * Tokens are lowercase labels aligned with [[Animal.diet]] sets and fruit labels.
 */
object FoodWeb {
  val observedMeals: Seq[MealRecord] =
    Seq(
      MealRecord("red fox", Fruit.Apple("Honeycrisp", Ripeness.Ripe)),
      MealRecord("grizzly bear", Fruit.Banana(0.55), Some("river bank")),
      MealRecord("house sparrow", Fruit.Cherry(8), Some("orchard fence")),
    )

  /** Adjacency: animal common name (lower-cased) -> food labels it is known to eat. */
  val eatsAdjacency: Map[String, Set[String]] =
    Map(
      "red fox" -> Set("apple", "grape", "mouse"),
      "grizzly bear" -> Set("apple", "banana", "berry", "salmon"),
      "gray wolf" -> Set("deer", "hare"),
      "house sparrow" -> Set("seed", "cherry"),
    )

  def foodsFor(animal: Animal): Set[String] =
    animal.diet.plants ++ animal.diet.prey

  def summarize(animal: Animal): String =
    s"${animal.displayName} eats: ${foodsFor(animal).mkString(", ")}"
}
