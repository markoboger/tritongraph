package com.example.animalsfruit.mammals.herbivores

import com.example.animalsfruit.mammals.Mammal
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
    with Grazer {
  def commonLabel: String = "american bison"
  def minHerdSize: Int = 8
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
    with Grazer {
  def commonLabel: String = "plains zebra"
  def minHerdSize: Int = 12
}
