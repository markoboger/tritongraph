package com.example.animalsfruit.arthropods.insects

import com.example.animalsfruit.arthropods.Arthropod

trait WingedInsect extends Arthropod {
  def wingPairs: Int
}

final class MonarchButterfly(val migrationKm: Double) extends WingedInsect {
  def segmentCount: Int = 3
  def commonLabel: String = "monarch butterfly"
  def wingPairs: Int = 1
}

final class CarpenterAnt(val colonySize: Int) extends Arthropod {
  def segmentCount: Int = 3
  def commonLabel: String = "carpenter ant"
}
