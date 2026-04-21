package com.example.animalsfruit.reptiles

/**
 * Reptiles split into sister subpackages [[lizards]] and [[snakes]].
 * We model a “covering” string so subclasses share a concrete constructor and the parser sees `extends Reptile("...")`.
 */
abstract class Reptile(val covering: String) {
  def ectothermic: Boolean = true

  def commonLabel: String
}
