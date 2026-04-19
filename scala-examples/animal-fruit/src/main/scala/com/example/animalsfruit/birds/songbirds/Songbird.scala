package com.example.animalsfruit.birds.songbirds

import com.example.animalsfruit.birds.Bird

trait Songbird extends Bird {
  def songComplexity: Int // 1–10
}

final class WinterWren(val wingspanCm: Double) extends Songbird {
  def commonLabel: String = "winter wren"
  def songComplexity: Int = 10
}

final class IndigoBunting(val wingspanCm: Double) extends Songbird {
  def commonLabel: String = "indigo bunting"
  def songComplexity: Int = 7
}
