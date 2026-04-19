package com.example.animalsfruit.mammals.carnivores

import com.example.animalsfruit.mammals.Mammal

/** Sister package `herbivores` mirrors this layout under [[com.example.animalsfruit.mammals]]. */
trait CarnivoreHunter {
  def clawSharpness: Int // 1–10
}

final class Lion(val prideSize: Int) extends Mammal("Carnivora") with CarnivoreHunter {
  def commonLabel: String = "lion"
  def clawSharpness: Int = 9
}

final class Tiger(val stripeCount: Int) extends Mammal("Carnivora") with CarnivoreHunter {
  def commonLabel: String = "tiger"
  def clawSharpness: Int = 9
}
