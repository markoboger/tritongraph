package com.example.animalsfruit.birds

/**
 * Birds split into sister subpackages [[raptors]] and [[songbirds]].
 * This trait is small on purpose: we just want a shared supertype that multiple packages can extend.
 */
trait Bird {
  def commonLabel: String
  def wingspanCm: Double
}
