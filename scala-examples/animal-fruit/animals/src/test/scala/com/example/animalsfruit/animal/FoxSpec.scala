package com.example.animalsfruit.animal

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class FoxSpec extends AnyWordSpec with Matchers {
  "Fox" should {
    "provide a stable displayName via Named + Lifeform self-type" in {
      val f = Fox(commonName = "red fox", cheekiness = 3, denId = Some("den-1"))
      f.displayName should include("red fox")
      f.displayName should include("Vulpes vulpes")
    }

    "use the default diet when overrideDiet is not provided" in {
      val f = Fox(commonName = "red fox", cheekiness = 9)
      f.diet.plants should contain allOf ("grape", "apple")
      f.diet.prey should contain("mouse")
    }

    "use overrideDiet when provided" in {
      val f = Fox(
        commonName = "test fox",
        cheekiness = 1,
        overrideDiet = Some(DietProfile.Carnivore(prey = Set("rabbit"))),
        favoriteFruit = Some(Fruit.Orange),
      )
      f.diet.plants shouldBe empty
      f.diet.prey should contain("rabbit")
      f.favoriteFruit shouldBe Some(Fruit.Orange)
    }
  }
}

