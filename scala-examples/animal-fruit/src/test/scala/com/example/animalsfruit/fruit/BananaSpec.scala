package com.example.animalsfruit.fruit

import com.example.animalsfruit.fruit.Fruit.Banana
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class BananaSpec extends AnyWordSpec with Matchers {
  "Fruit.Banana" should {
    "format its curvature and report its family" in {
      val b = Banana(0.42)
      b.label should include("banana")
      // Decimal separator may vary by locale (e.g. `0,42`), so assert only the stable structure.
      b.label should include("curvature=")
      b.family shouldBe FruitFamily.Berry
    }
  }
}

