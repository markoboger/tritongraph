package com.example.animalsfruit.mammals.herbivores

import com.example.animalsfruit.mammals.{Mammal, Nursing}
import com.example.animalsfruit.fruit.Fruit

import scala.util.Try

/**
 * Tags an animal as a grazer.
 * The method is small but gives us a clean sister-package parallel to `CarnivoreHunter`.
 */
trait Grazer {
  def minHerdSize: Int
}

/**
 * Bison herd member with a name and some tracking metadata.
 * We keep one fruit parameter (`favorite`) so other packages can talk about food preferences.
 */
final class Bison(
    val rangeHa: Double,
    val herdName: String,
    val hornSpanCm: Option[Int] = None,
    val trackerBatteryPct: Try[Int] = Try(100),
    val favorite: Option[Fruit.Apple] = None, // cross-package artefact
) extends Mammal("Artiodactyla")
    with Grazer
    with Nursing {
  def commonLabel: String = "american bison"
  def minHerdSize: Int = 8
  def nursingMonths: Int = 10
}

/**
 * Zebra with stripes, an id, and a few optional notes (waterhole, vet visit).
 * This class is mostly here to create a second concrete grazer with a different constructor shape.
 */
final class Zebra(
    val stripeParity: String,
    val individualId: String,
    val foalCount: Int = 0,
    val waterhole: Option[String] = None,
    val lastVetVisitDaysAgo: Try[Int] = Try(30),
    val offeredFruit: Option[Fruit] = None, // cross-package artefact
) extends Mammal("Perissodactyla")
    with Grazer
    with Nursing {
  def commonLabel: String = "plains zebra"
  def minHerdSize: Int = 12
  def nursingMonths: Int = 11
}

/**
 * Companion-style sample data for the herbivore branch of the demo.
 * This gives the diagram a second package with obvious constructor traffic.
 */
object GrazerShowcase {
  val plainsHerd: Seq[Mammal] =
    Seq(
      new Bison(
        rangeHa = 980.0,
        herdName = "north meadow",
        favorite = Some(Fruit.Apple("Empire", com.example.animalsfruit.fruit.Ripeness.Green)),
      ),
      new Zebra(
        stripeParity = "odd",
        individualId = "z-14",
        offeredFruit = Some(Fruit.Grape("moon drop")),
      ),
    )
}
