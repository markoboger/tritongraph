package com.example.animalsfruit.animal

/**
 * Wildcard: package-level import (diagrammed as `animal` → `fruit`, not a single-type edge).
 * We keep this here to produce an import edge in the package graph and to exercise `_` imports.
 */
import com.example.animalsfruit.fruit._

import scala.util.Try

/**
 * Anything alive in our toy model.
 * The only required piece of metadata is a stable `speciesLabel` for display and grouping.
 */
abstract class Lifeform {
  def speciesLabel: String
}

/**
 * Adds a human-facing name and a formatted `displayName`.
 * The self-type makes it explicit that names only make sense on actual `Lifeform`s.
 */
trait Named { self: Lifeform =>
  def commonName: String

  final def displayName: String = s"$commonName (${self.speciesLabel})"
}

/**
 * Shared superclass for chordate-style creatures in this demo.
 * This extra hop exists mostly so the parser sees a small inheritance chain.
 */
abstract class Lifebody extends Lifeform

/**
 * Very small concrete base class that carries a species label.
 * Several demo types extend this, which mirrors common “domain base class” patterns.
 */
class Vertebrate(val speciesLabel: String) extends Lifebody

/**
 * Animals always have a vertebrate body plan here (self-type).
 * `Named` is mixed in so parsers see multiple trait compositions.
 */
sealed trait Animal extends Named { this: Vertebrate =>
  def diet: DietProfile
}

/**
 * Diet described as sets of plant tokens and prey tokens.
 * Tokens are intentionally strings so the example stays lightweight and cross-module friendly.
 */
trait DietProfile {
  def plants: Set[String]
  def prey: Set[String]
}

/**
 * ADT-style constructors for diets.
 * Using `case class` variants makes it easy to pattern match later if you expand the demo.
 */
object DietProfile {
  /** Eats both plant matter and prey. */
  final case class Omnivore(plants: Set[String], prey: Set[String]) extends DietProfile
  /** Eats plants only; prey is always empty. */
  final case class Herbivore(plants: Set[String]) extends DietProfile {
    def prey: Set[String] = Set.empty
  }
  /** Eats prey only; plants is always empty. */
  final case class Carnivore(prey: Set[String]) extends DietProfile {
    def plants: Set[String] = Set.empty
  }
}

/**
 * Capability mixin (stacked traits).
 * We use this to show how a concrete `case object` can also provide behavior.
 */
trait PackHunter {
  def packSize: Int
}

/**
 * Fox is a small omnivore with optional metadata (den id, last note, favorite fruit).
 * `overrideDiet` is intentionally present so tests and examples can exercise both branches.
 */
final case class Fox(
    commonName: String,
    cheekiness: Int,
    denId: Option[String] = None,
    lastSeenNote: Try[String] = Try("near orchard"),
    favoriteFruit: Option[Fruit] = Some(Fruit.Grape("concord")),
    overrideDiet: Option[DietProfile] = None, // same-package artefact
)
    extends Vertebrate("Vulpes vulpes")
    with Animal {
  def diet: DietProfile =
    overrideDiet.getOrElse(
      DietProfile.Omnivore(
        plants = Set("grape", "apple"),
        prey = Set("mouse"),
      ),
    )
}

/**
 * Bear is larger, heavier, and still an omnivore in this toy model.
 * The constructor includes a couple of “real-world-ish” fields (GPS fix, last fished) to
 * exercise standard library types wrapped in `Try` and `Option`.
 */
final case class Bear(
    commonName: String,
    weightKg: Double,
    favoriteSnack: Option[Fruit.Banana] = None, // cross-package nested artefact
    gpsFix: Try[(Double, Double)] = Try((47.0, -122.0)),
    lastFished: Option[Int] = None,
    overrideDiet: Option[DietProfile] = None, // same-package artefact
)
    extends Vertebrate("Ursus arctos")
    with Animal {
  def diet: DietProfile =
    overrideDiet.getOrElse(
      DietProfile.Omnivore(
        plants = Set("apple", "banana", "berry"),
        prey = Set("salmon"),
      ),
    )
}

/**
 * A singleton wolf with a fixed pack size.
 * Case objects are common for canonical instances, and they make good parser test data.
 */
case object Wolf extends Vertebrate("Canis lupus") with Animal with PackHunter {
  val commonName: String = "gray wolf"
  val packSize: Int = 6

  def diet: DietProfile =
    DietProfile.Carnivore(prey = Set("deer", "hare"))
}

/**
 * Simple capability trait for flight-ish creatures.
 * We keep it orthogonal to `Animal` so different example types can mix it in selectively.
 */
trait Winged {
  def wingspanCm: Double
}

/**
 * A tiny bird class that mixes `Animal` and `Winged`.
 * It's intentionally not a case class so the example includes a “plain” `final class` constructor.
 */
final class Sparrow(
    val wingspanCm: Double,
    val band: Option[String] = None,
    val feederVisits: Int = 0,
    val lastSeedType: Try[String] = Try("millet"),
    val stolenFruit: Option[Fruit] = None, // cross-package artefact
)
    extends Vertebrate("Passer domesticus")
    with Animal
    with Winged {
  val commonName: String = "house sparrow"

  def diet: DietProfile =
    DietProfile.Herbivore(plants = Set("seed", "cherry"))
}

/**
 * Type-parameterised capability: who can eat which produce type.
 * This is mostly here so the Scala parser sees a higher-kinded-ish bound (`P <: Produce`).
 */
trait Consumer[P <: Produce] {
  def munch(item: P): String
}
