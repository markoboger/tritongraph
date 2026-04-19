package com.example.animalsfruit.taxonomy

import com.example.animalsfruit.arthropods.crustaceans.BlueCrab
import com.example.animalsfruit.arthropods.insects.MonarchButterfly
import com.example.animalsfruit.birds.raptors.GoldenEagle
import com.example.animalsfruit.birds.songbirds.WinterWren
import com.example.animalsfruit.mammals.carnivores.Lion
import com.example.animalsfruit.mammals.herbivores.Bison
import com.example.animalsfruit.reptiles.lizards.LeopardGecko
import com.example.animalsfruit.reptiles.snakes.BallPython

/**
 * Pulls one representative from each nested sister pair so package nesting is visibly connected
 * without collapsing everything into a single directory.
 */
object Catalog {
  val showcaseLabels: Seq[String] =
    Seq(
      new Lion(6).commonLabel,
      new Bison(1200.0).commonLabel,
      new GoldenEagle(12.0, 210.0).commonLabel,
      new WinterWren(15.0).commonLabel,
      new LeopardGecko("high-yellow").commonLabel,
      new BallPython(1.1).commonLabel,
      new MonarchButterfly(4000.0).commonLabel,
      new BlueCrab(18.0).commonLabel,
    )

  def summary: String = showcaseLabels.mkString(" / ")
}
