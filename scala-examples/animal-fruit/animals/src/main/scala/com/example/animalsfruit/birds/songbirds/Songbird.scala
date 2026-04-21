package com.example.animalsfruit.birds.songbirds

import com.example.animalsfruit.birds.Bird
import com.example.animalsfruit.fruit.Fruit

import scala.util.Try

/**
 * Songbirds are [[Bird]]s with an arbitrary “song complexity” score.
 * This trait is a sibling to `raptors.Raptor`, helping demonstrate sister packages.
 */
trait Songbird extends Bird {
  def songComplexity: Int // 1–10
}

/**
 * Winter wren with a high song complexity in this toy model.
 * The `lastSongNotes` field is just there so the constructor includes a collection wrapped in `Try`.
 */
final class WinterWren(
    val wingspanCm: Double,
    val territoryName: String,
    val ring: Option[Int] = None,
    val lastSongNotes: Try[Vector[String]] = Try(Vector("ti", "ti", "trill")),
    val berrySnack: Option[Fruit.Cherry] = None, // cross-package artefact
) extends Songbird {
  def commonLabel: String = "winter wren"
  def songComplexity: Int = 10
}

/**
 * Indigo bunting with an observer note and a tiny flock size.
 * The `lastSeenAt` tuple shows how constructor types can contain nested structures without new classes.
 */
final class IndigoBunting(
    val wingspanCm: Double,
    val observer: String,
    val flockSize: Int = 1,
    val acceptedGift: Option[Fruit] = None, // cross-package artefact
    val lastSeenAt: Try[(Double, Double)] = Try((0.0, 0.0)), // tuple inside Try
) extends Songbird {
  def commonLabel: String = "indigo bunting"
  def songComplexity: Int = 7
}

/**
 * Small package-local flock used to advertise constructor calls in the diagram.
 */
object SongbirdShowcase {
  val flock: Seq[Songbird] =
    Seq(
      new WinterWren(
        wingspanCm = 16.0,
        territoryName = "fern hollow",
        berrySnack = Some(Fruit.Cherry(5)),
      ),
      new IndigoBunting(
        wingspanCm = 24.0,
        observer = "field lab",
        acceptedGift = Some(Fruit.Apple("Elstar", com.example.animalsfruit.fruit.Ripeness.Ripe)),
      ),
    )
}
