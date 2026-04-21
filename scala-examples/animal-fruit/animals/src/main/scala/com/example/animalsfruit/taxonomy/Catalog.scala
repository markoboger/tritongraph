package com.example.animalsfruit.taxonomy

import com.example.animalsfruit.arthropods.crustaceans.BlueCrab
import com.example.animalsfruit.arthropods.insects.MonarchButterfly
import com.example.animalsfruit.birds.raptors.GoldenEagle
import com.example.animalsfruit.birds.songbirds.WinterWren
import com.example.animalsfruit.fruit.{Fruit, Ripeness}
import com.example.animalsfruit.mammals.carnivores.Lion
import com.example.animalsfruit.mammals.herbivores.Bison
import com.example.animalsfruit.reptiles.lizards.LeopardGecko
import com.example.animalsfruit.reptiles.snakes.BallPython

/**
 * Pulls one representative from each nested sister pair so package nesting is visibly connected
 * without collapsing everything into a single directory.
 */
object Catalog {
  /**
   * A short list of labels that touches many packages at once.
   * This file intentionally imports a lot, so the package-graph view can show “sibling package” edges.
   */
  val showcaseLabels: Seq[String] =
    Seq(
      new Lion(prideSize = 6, favoriteFruit = Some(Fruit.Apple("Gala", Ripeness.Ripe))).commonLabel,
      new Bison(rangeHa = 1200.0, herdName = "prairie-bunch", favorite = Some(Fruit.Apple("Cortland", Ripeness.Green))).commonLabel,
      new GoldenEagle(talonGripKg = 12.0, wingspanCm = 210.0, nestingCliff = "east face").commonLabel,
      new WinterWren(wingspanCm = 15.0, territoryName = "cedar thicket").commonLabel,
      new LeopardGecko(pattern = "high-yellow", morphName = "tangerine", hatchYear = 2022).commonLabel,
      new BallPython(lengthM = 1.1, morph = "pastel", enrichmentFruit = Some(Fruit.Orange)).commonLabel,
      new MonarchButterfly(migrationKm = 4000.0, nectarSource = Some(Fruit.Cherry(6))).commonLabel,
      new BlueCrab(carapaceWidthCm = 18.0, bay = "chesapeake", moltCount = 3).commonLabel,
    )

  /** A compact string that `Demo` can print in one line. */
  def summary: String = showcaseLabels.mkString(" / ")
}
