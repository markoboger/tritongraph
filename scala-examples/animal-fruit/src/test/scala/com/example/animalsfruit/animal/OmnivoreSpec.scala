package com.example.animalsfruit.animal

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class OmnivoreSpec extends AnyWordSpec with Matchers {
  "DietProfile.Omnivore" should {
    "retain plants and prey sets" in {
      val d = DietProfile.Omnivore(plants = Set("apple"), prey = Set("mouse"))
      d.plants shouldBe Set("apple")
      d.prey shouldBe Set("mouse")
    }
  }
}

