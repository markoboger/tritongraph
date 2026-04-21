package com.example.animalsfruit.arthropods.crustaceans

import com.example.animalsfruit.arthropods.Arthropod
import com.example.animalsfruit.fruit.Fruit

import scala.util.Try

/**
 * Decapods are ten-legged arthropods (in this toy model).
 * We provide a default `walkingLegPairs` so implementations can stay small.
 */
trait Decapod extends Arthropod {
  def walkingLegPairs: Int = 5
}

/**
 * Blue crab with bay metadata and a salinity reading.
 * `baitFruit` is intentionally odd, but it produces a clean `Fruit` reference from another package.
 */
final class BlueCrab(
    val carapaceWidthCm: Double,
    val bay: String,
    val moltCount: Int,
    val salinityPpt: Try[Double] = Try(15.0),
    val baitFruit: Option[Fruit] = None, // cross-package artefact
) extends Decapod {
  def segmentCount: Int = 2
  def commonLabel: String = "blue crab"
}

/**
 * Hermit crab with a shell history and a hideout note.
 * The constructor mixes primitives, `Option`, and `Try` to give the parser variety.
 */
final class HermitCrab(
    val shellBorrowed: Boolean,
    val shellFrom: Option[String] = None,
    val movedTimes: Int = 0,
    val lastHideout: Try[String] = Try("tidepool"),
    val curiosityFruit: Option[Fruit.Cherry] = None, // cross-package artefact
) extends Decapod {
  def segmentCount: Int = 2
  def commonLabel: String = "hermit crab"
}
