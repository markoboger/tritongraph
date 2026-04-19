package com.example.animalsfruit.arthropods.crustaceans

import com.example.animalsfruit.arthropods.Arthropod

trait Decapod extends Arthropod {
  def walkingLegPairs: Int = 5
}

final class BlueCrab(val carapaceWidthCm: Double) extends Decapod {
  def segmentCount: Int = 2
  def commonLabel: String = "blue crab"
}

final class HermitCrab(val shellBorrowed: Boolean) extends Decapod {
  def segmentCount: Int = 2
  def commonLabel: String = "hermit crab"
}
