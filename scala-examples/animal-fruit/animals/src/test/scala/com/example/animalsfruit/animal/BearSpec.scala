package com.example.animalsfruit.animal

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class BearSpec extends AnyWordSpec with Matchers {
  "Bear" should {
    "derive displayName and expose its Vertebrate species label" in {
      val b = Bear(commonName = "grizzly bear", weightKg = 250.0, favoriteSnack = Some(Fruit.Banana(0.3)))
      b.displayName should include("grizzly bear")
      b.displayName should include("Ursus arctos")
    }

    "default to an omnivore diet when overrideDiet is absent" in {
      val b = Bear(commonName = "bear", weightKg = 10.0)
      b.diet.plants should contain("banana")
      b.diet.prey should contain("salmon")
    }

    "respect overrideDiet when present" in {
      val b = Bear(
        commonName = "strict",
        weightKg = 10.0,
        overrideDiet = Some(DietProfile.Herbivore(plants = Set("berry"))),
      )
      b.diet.prey shouldBe empty
      b.diet.plants shouldBe Set("berry")
    }
  }
}

