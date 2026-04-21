package com.example.animalsfruit.reptiles.lizards

import com.example.animalsfruit.reptiles.Reptile
import com.example.animalsfruit.fruit.Fruit

import scala.util.Try

/**
 * Marks a reptile as able to drop its tail (autotomy).
 * It’s a simple trait, but it gives the inheritance graph another distinct edge.
 */
trait Autotomous {
  def canDropTail: Boolean
}

/**
 * Leopard gecko with a morph name and a hatch year.
 * The optional fruit is intentionally a “weird” field—useful as cross-package constructor data.
 */
final class LeopardGecko(
    val pattern: String,
    val morphName: String,
    val hatchYear: Int,
    val keeperNotes: Option[String] = None,
    val lastShedDaysAgo: Try[Int] = Try(14),
    val offeredFruit: Option[Fruit] = None, // cross-package artefact
) extends Reptile("granular scales")
    with Autotomous {
  def commonLabel: String = "leopard gecko"
  def canDropTail: Boolean = true
}

/**
 * Green iguana with a basking temperature and a preferred leaf.
 * This constructor is shaped differently from `LeopardGecko` so type extraction sees variety.
 */
final class GreenIguana(
    val snoutVentLengthCm: Double,
    val nickname: String,
    val baskingSpotC: Try[Double] = Try(32.0),
    val favoriteLeaf: Option[String] = Some("collard"),
    val stolenSnack: Option[Fruit.Banana] = None, // cross-package nested artefact
) extends Reptile("keeled scales")
    with Autotomous {
  def commonLabel: String = "green iguana"
  def canDropTail: Boolean = true
}

/**
 * Demo residents for the lizard package.
 */
object LizardShowcase {
  val baskingCrew: Seq[Reptile] =
    Seq(
      new LeopardGecko(
        pattern = "spotted",
        morphName = "bell albino",
        hatchYear = 2021,
        offeredFruit = Some(Fruit.Banana(0.61)),
      ),
      new GreenIguana(
        snoutVentLengthCm = 38.0,
        nickname = "canopy",
        stolenSnack = Some(Fruit.Banana(0.48)),
      ),
    )
}
