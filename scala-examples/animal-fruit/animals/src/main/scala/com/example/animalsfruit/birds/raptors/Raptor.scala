package com.example.animalsfruit.birds.raptors

import com.example.animalsfruit.birds.Bird
import com.example.animalsfruit.fruit.Fruit

import scala.util.Try

/**
 * A raptor is a [[Bird]] that can grip with talons.
 * This lives in a nested package to create a clean “birds → birds.raptors” containment edge.
 */
trait Raptor extends Bird {
  def talonGripKg: Double
}

/**
 * Golden eagle with a couple of tracking fields and an optional cached snack.
 * The values are not “realistic”; they’re meant to be varied enough for parser and UI demos.
 */
final class GoldenEagle(
    val talonGripKg: Double,
    val wingspanCm: Double,
    val bandCode: Option[String] = None,
    val nestingCliff: String = "unknown",
    val lastDiveSpeedKmh: Try[Double] = Try(120.0),
    val cachedSnack: Option[Fruit] = None, // cross-package artefact
) extends Raptor {
  def commonLabel: String = "golden eagle"
}

/**
 * Peregrine falcon with a fixed `talonGripKg` and a required nickname.
 * It uses `Try[List[String]]` to show nested standard-library types inside a wrapper.
 */
final class PeregrineFalcon(
    val diveSpeedKmh: Double,
    val wingspanCm: Double,
    val nickname: String,
    val preyPreference: Option[String] = None,
    val travelLog: Try[List[String]] = Try(List("ridge", "river")), // stdlib collection inside Try
    val giftedFruit: Option[Fruit.Orange.type] = None, // cross-package singleton artefact
) extends Raptor {
  def commonLabel: String = "peregrine falcon"
  def talonGripKg: Double = 5.5
}

/**
 * Short showcase collection for the raptor package.
 * Separate package-local samples make the `creates` relationship easier to inspect than one giant catalog.
 */
object RaptorShowcase {
  val residentBirds: Seq[Raptor] =
    Seq(
      new GoldenEagle(
        talonGripKg = 11.5,
        wingspanCm = 205.0,
        cachedSnack = Some(Fruit.Cherry(9)),
      ),
      new PeregrineFalcon(
        diveSpeedKmh = 320.0,
        wingspanCm = 110.0,
        nickname = "needle",
        giftedFruit = Some(Fruit.Orange),
      ),
    )
}
