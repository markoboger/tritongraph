package com.example.animalsfruit.mammals

/** Base of all mammals in this demo (parent package for nested sister subpackages). */
abstract class Mammal(val taxonOrder: String) {
  def isWarmBlooded: Boolean = true

  def commonLabel: String
}
