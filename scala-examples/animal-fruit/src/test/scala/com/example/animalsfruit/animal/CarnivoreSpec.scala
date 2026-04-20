package com.example.animalsfruit.animal

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class CarnivoreSpec extends AnyWordSpec with Matchers {
  "DietProfile.Carnivore" should {
    "have an empty plants set by definition" in {
      val d = DietProfile.Carnivore(prey = Set("hare"))
      d.prey shouldBe Set("hare")
      d.plants shouldBe empty
    }
  }
}

