package com.example.animalsfruit.animal

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class SparrowSpec extends AnyWordSpec with Matchers {
  "Sparrow" should {
    "be winged and herbivorous in this toy model" in {
      val s = new Sparrow(wingspanCm = 15.0, band = Some("A-12"), feederVisits = 2, stolenFruit = Some(Fruit.Cherry(5)))
      s.wingspanCm shouldBe 15.0
      s.diet.prey shouldBe empty
      s.diet.plants should contain allOf ("seed", "cherry")
      s.displayName should include("house sparrow")
      s.displayName should include("Passer domesticus")
    }
  }
}

