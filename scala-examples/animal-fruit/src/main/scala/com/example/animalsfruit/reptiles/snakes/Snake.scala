package com.example.animalsfruit.reptiles.snakes

import com.example.animalsfruit.reptiles.Reptile
import com.example.animalsfruit.fruit.Fruit

import scala.util.Try

/**
 * Constrictors apply pressure to subdue prey.
 * The trait is used by `BallPython` to show a clear “class with trait” relationship.
 */
trait Constrictor {
  def coilPressurePsi: Double
}

/**
 * Ball python with a morph name and a handful of enclosure/feeding fields.
 * We also include a singleton fruit type (`Fruit.Orange.type`) to exercise that corner of Scala’s type system.
 */
final class BallPython(
    val lengthM: Double,
    val morph: String,
    val enclosureId: Option[String] = None,
    val lastMeal: Try[String] = Try("mouse"),
    val temperatureC: Try[Double] = Try(28.0),
    val enrichmentFruit: Option[Fruit.Orange.type] = None, // cross-package singleton artefact
) extends Reptile("smooth scales")
    with Constrictor {
  def commonLabel: String = "ball python"
  def coilPressurePsi: Double = 30.0
}

/**
 * Eastern racer, a fast snake with a nickname and a list of sightings.
 * The `sightings` list is plain data, but it’s enough to create a nested type (`List[(Double, Double)]`) for parsers.
 */
final class EasternRacer(
    val maxSpeedKmh: Double,
    val nickname: String,
    val sightings: List[(Double, Double)],
    val tailMark: Option[String] = None,
    val lastSnack: Option[Fruit] = None, // cross-package artefact
) extends Reptile("smooth scales") {
  def commonLabel: String = "eastern racer"
}
