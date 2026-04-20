package com.example.animalsfruit.arthropods

/**
 * Arthropods split into sister subpackages [[insects]] and [[crustaceans]].
 * It’s a trait (not an abstract class) to keep the inheritance mix flexible in the example set.
 */
trait Arthropod {
  def segmentCount: Int
  def commonLabel: String
}
