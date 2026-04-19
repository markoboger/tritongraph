package com.example.animalsfruit.mammals.herbivores

import com.example.animalsfruit.mammals.Mammal

trait Grazer {
  def minHerdSize: Int
}

final class Bison(val rangeHa: Double) extends Mammal("Artiodactyla") with Grazer {
  def commonLabel: String = "american bison"
  def minHerdSize: Int = 8
}

final class Zebra(val stripeParity: String) extends Mammal("Perissodactyla") with Grazer {
  def commonLabel: String = "plains zebra"
  def minHerdSize: Int = 12
}
