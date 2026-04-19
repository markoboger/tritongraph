package com.example.animalsfruit.animal

/** Wildcard: package-level import (diagrammed as `animal` → `fruit`, not a single-type edge). */
import com.example.animalsfruit.fruit._

/** Anything alive in our toy model. */
abstract class Lifeform {
  def speciesLabel: String
}

trait Named { self: Lifeform =>
  def commonName: String

  final def displayName: String = s"$commonName (${self.speciesLabel})"
}

/** Shared superclass for chordate-style creatures in this demo. */
abstract class Lifebody extends Lifeform

class Vertebrate(val speciesLabel: String) extends Lifebody

/**
 * Animals always have a vertebrate body plan here (self-type).
 * `Named` is mixed in so parsers see multiple trait compositions.
 */
sealed trait Animal extends Named { this: Vertebrate =>
  def diet: DietProfile
}

/** Diet described as sets of produce labels and optional prey names. */
trait DietProfile {
  def plants: Set[String]
  def prey: Set[String]
}

object DietProfile {
  final case class Omnivore(plants: Set[String], prey: Set[String]) extends DietProfile
  final case class Herbivore(plants: Set[String]) extends DietProfile {
    def prey: Set[String] = Set.empty
  }
  final case class Carnivore(prey: Set[String]) extends DietProfile {
    def plants: Set[String] = Set.empty
  }
}

/** Capability mixin (stacked traits). */
trait PackHunter {
  def packSize: Int
}

final case class Fox(commonName: String, cheekiness: Int)
    extends Vertebrate("Vulpes vulpes")
    with Animal {
  def diet: DietProfile =
    DietProfile.Omnivore(
      plants = Set("grape", "apple"),
      prey = Set("mouse"),
    )
}

final case class Bear(commonName: String, weightKg: Double)
    extends Vertebrate("Ursus arctos")
    with Animal {
  def diet: DietProfile =
    DietProfile.Omnivore(
      plants = Set("apple", "banana", "berry"),
      prey = Set("salmon"),
    )
}

case object Wolf extends Vertebrate("Canis lupus") with Animal with PackHunter {
  val commonName: String = "gray wolf"
  val packSize: Int = 6

  def diet: DietProfile =
    DietProfile.Carnivore(prey = Set("deer", "hare"))
}

trait Winged {
  def wingspanCm: Double
}

final class Sparrow(val wingspanCm: Double)
    extends Vertebrate("Passer domesticus")
    with Animal
    with Winged {
  val commonName: String = "house sparrow"

  def diet: DietProfile =
    DietProfile.Herbivore(plants = Set("seed", "cherry"))
}

/** Type-parameterised capability: who can eat which produce type. */
trait Consumer[P <: Produce] {
  def munch(item: P): String
}
