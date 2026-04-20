package com.example.animalsfruit.arthropods.insects

import com.example.animalsfruit.arthropods.Arthropod
import com.example.animalsfruit.fruit.Fruit

import scala.util.Try

/**
 * Winged insects are a subset of [[Arthropod]]s with wing pairs.
 * This is a nested trait so we can demonstrate “trait extends trait” in a subpackage.
 */
trait WingedInsect extends Arthropod {
  def wingPairs: Int
}

/**
 * Monarch butterfly with migration distance and a couple of optional tracking fields.
 * The goal is to have enough constructor types for “uses” edges without making the model deep.
 */
final class MonarchButterfly(
    val migrationKm: Double,
    val tag: Option[String] = None,
    val generation: Int = 1,
    val nectarSource: Option[Fruit] = None, // cross-package artefact
    val windAssistKmh: Try[Double] = Try(5.0),
) extends WingedInsect {
  def segmentCount: Int = 3
  def commonLabel: String = "monarch butterfly"
  def wingPairs: Int = 1
}

/**
 * Carpenter ant with a nest tree and a flag for whether the queen is present.
 * Including a `Fruit.Grape` parameter produces a useful cross-package reference in the parser output.
 */
final class CarpenterAnt(
    val colonySize: Int,
    val nestTree: String,
    val queenPresent: Boolean,
    val observedForagingFruit: Option[Fruit.Grape] = None, // cross-package nested artefact
    val humidityPct: Try[Int] = Try(55),
) extends Arthropod {
  def segmentCount: Int = 3
  def commonLabel: String = "carpenter ant"
}
