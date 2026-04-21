package com.example.animalsfruit.mammals

/**
 * Base of all mammals in this demo (parent package for nested sister subpackages).
 * It’s deliberately minimal: subclasses provide the interesting fields, while this anchors the hierarchy.
 */
abstract class Mammal(val taxonOrder: String) {
  def isWarmBlooded: Boolean = true

  def commonLabel: String
}

/**
 * Cross-package mixin that subpackages can attach with `with`.
 * This gives the package diagram an unmistakable `has trait` edge from e.g. `Lion` back into
 * the parent `mammals` package.
 */
trait Nursing {
  def nursingMonths: Int
}
