package com.example.animalsfruit.mammals

/**
 * Base of all mammals in this demo (parent package for nested sister subpackages).
 * It’s deliberately minimal: subclasses provide the interesting fields, while this anchors the hierarchy.
 */
abstract class Mammal(val taxonOrder: String) {
  def isWarmBlooded: Boolean = true

  def commonLabel: String
}
