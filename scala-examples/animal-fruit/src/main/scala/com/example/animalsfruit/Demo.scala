package com.example.animalsfruit

import com.example.animalsfruit.animal.{Bear, Consumer, Fox, Wolf}
import com.example.animalsfruit.fruit.{Fruit, Ripeness}
import com.example.animalsfruit.relation.FoodWeb
import com.example.animalsfruit.taxonomy.Catalog

/** Example [[Consumer]] with a type bound to a concrete fruit. */
object FoxAppleEater extends Consumer[Fruit.Apple] {
  def munch(item: Fruit.Apple): String = s"fox enjoyed ${item.label}"
}

object Demo extends App {
  val foxy: Fox = Fox("Rufus", cheekiness = 9)
  val ursine: Bear = Bear("Ursula", weightKg = 220.0)

  println(FoodWeb.summarize(foxy))
  println(FoodWeb.summarize(ursine))
  println(FoodWeb.summarize(Wolf))
  println(FoxAppleEater.munch(Fruit.Apple("Cox", Ripeness.Ripe)))
  FoodWeb.observedMeals.foreach(m => println(m))
  println(Catalog.summary)
}
