package com.example.animalsfruit.reptiles.lizards

import com.example.animalsfruit.reptiles.Reptile

trait Autotomous {
  def canDropTail: Boolean
}

final class LeopardGecko(val pattern: String) extends Reptile("granular scales") with Autotomous {
  def commonLabel: String = "leopard gecko"
  def canDropTail: Boolean = true
}

final class GreenIguana(val snoutVentLengthCm: Double) extends Reptile("keeled scales") with Autotomous {
  def commonLabel: String = "green iguana"
  def canDropTail: Boolean = true
}
