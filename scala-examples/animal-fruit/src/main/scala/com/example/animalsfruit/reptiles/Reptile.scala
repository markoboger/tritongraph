package com.example.animalsfruit.reptiles

/** Reptiles split into sister subpackages [[lizards]] and [[snakes]]. */
abstract class Reptile(val covering: String) {
  def ectothermic: Boolean = true

  def commonLabel: String
}
