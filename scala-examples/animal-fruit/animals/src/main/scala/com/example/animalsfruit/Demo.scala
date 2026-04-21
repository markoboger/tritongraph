package com.example.animalsfruit

import com.example.animalsfruit.animal.{Bear, Consumer, Fox, Wolf}
import com.example.animalsfruit.fruit.{Fruit, Ripeness}
import com.example.animalsfruit.relation.FoodWeb
import com.example.animalsfruit.taxonomy.Catalog

/**
 * Example [[Consumer]] with a type bound to a concrete fruit.
 * This gives the parser a small generic type application (`Consumer[Fruit.Apple]`) to discover.
 */
object FoxAppleEater extends Consumer[Fruit.Apple] {
  def munch(item: Fruit.Apple): String = s"fox enjoyed ${item.label}"
}

/**
 * Tiny runnable entry point that wires together the model.
 * It prints a few summaries and observed meals; the goal is to make the example feel “alive”
 * without turning it into an application.
 */
object Demo extends App {
  val foxy: Fox = Fox(
    commonName = "Rufus",
    cheekiness = 9,
    denId = Some("den-7"),
    favoriteFruit = Some(Fruit.Grape("concord")),
  )
  val ursine: Bear = Bear(
    commonName = "Ursula",
    weightKg = 220.0,
    favoriteSnack = Some(Fruit.Banana(0.55)),
  )

  println(FoodWeb.summarize(foxy))
  println(FoodWeb.summarize(ursine))
  println(FoodWeb.summarize(Wolf))
  println(FoxAppleEater.munch(Fruit.Apple("Cox", Ripeness.Ripe)))
  FoodWeb.observedMeals.foreach(m => println(m))
  println(Catalog.summary)
}
