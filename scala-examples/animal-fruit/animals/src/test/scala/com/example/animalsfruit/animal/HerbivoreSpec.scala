package com.example.animalsfruit.animal

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class HerbivoreSpec extends AnyWordSpec with Matchers {
  "DietProfile.Herbivore" should {
    "have an empty prey set by definition" in {
      val d = DietProfile.Herbivore(plants = Set("seed", "cherry"))
      d.plants should contain("seed")
      d.prey shouldBe empty
    }
  }
}

