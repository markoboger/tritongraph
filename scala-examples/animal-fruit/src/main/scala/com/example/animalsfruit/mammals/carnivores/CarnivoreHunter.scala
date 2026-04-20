package com.example.animalsfruit.mammals.carnivores

import com.example.animalsfruit.mammals.Mammal
import com.example.animalsfruit.fruit.Fruit

import scala.util.Try

/**
 * Marks a mammal as a hunter in this demo.
 * It’s intentionally tiny, but it creates a clear trait edge to parse and render.
 */
trait CarnivoreHunter {
  def clawSharpness: Int // 1–10
}

/**
 * A lion: pride-based, tagged, and optionally “likes fruit” (for cross-package references).
 * The `rival` parameter points at a same-package class to create an intra-package “uses” edge.
 */
final class Lion(
    val prideSize: Int,
    val nickname: String = "king",
    val tagId: Option[String] = None,
    val lastWeighedKg: Try[Double] = Try(190.0),
    val favoriteFruit: Option[Fruit] = None, // cross-package artefact
    val rival: Option[Tiger] = None, // same-package artefact
) extends Mammal("Carnivora")
    with CarnivoreHunter {
  def commonLabel: String = "lion"
  def clawSharpness: Int = 9
}

/**
 * A tiger with stripes and a couple of optional metadata fields.
 * We include a nested-type reference (`Fruit.Banana`) as a constructor parameter to drive a “uses” edge.
 */
final class Tiger(
    val stripeCount: Int,
    val subspecies: String = "bengal",
    val territoryKm2: Try[Int] = Try(60),
    val knownAs: Option[String] = Some("shadow"),
    val snack: Option[Fruit.Banana] = None, // cross-package + nested artefact
) extends Mammal("Carnivora")
    with CarnivoreHunter {
  def commonLabel: String = "tiger"
  def clawSharpness: Int = 9
}
