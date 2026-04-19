package com.example.animalsfruit.birds.raptors

import com.example.animalsfruit.birds.Bird

trait Raptor extends Bird {
  def talonGripKg: Double
}

final class GoldenEagle(val talonGripKg: Double, val wingspanCm: Double) extends Raptor {
  def commonLabel: String = "golden eagle"
}

final class PeregrineFalcon(val diveSpeedKmh: Double, val wingspanCm: Double) extends Raptor {
  def commonLabel: String = "peregrine falcon"
  def talonGripKg: Double = 5.5
}
