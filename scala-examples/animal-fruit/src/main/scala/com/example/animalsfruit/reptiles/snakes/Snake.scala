package com.example.animalsfruit.reptiles.snakes

import com.example.animalsfruit.reptiles.Reptile

trait Constrictor {
  def coilPressurePsi: Double
}

final class BallPython(val lengthM: Double) extends Reptile("smooth scales") with Constrictor {
  def commonLabel: String = "ball python"
  def coilPressurePsi: Double = 30.0
}

final class EasternRacer(val maxSpeedKmh: Double) extends Reptile("smooth scales") {
  def commonLabel: String = "eastern racer"
}
