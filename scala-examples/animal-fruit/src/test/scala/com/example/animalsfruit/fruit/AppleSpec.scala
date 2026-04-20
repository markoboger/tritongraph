package com.example.animalsfruit.fruit

import com.example.animalsfruit.fruit.Fruit.Apple
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class AppleSpec extends AnyWordSpec with Matchers {
  "Fruit.Apple" should {
    "render a label and report its family" in {
      val a = Apple("Gala", Ripeness.Ripe)
      a.label should include("Gala apple")
      a.label should include("ripe")
      a.family shouldBe FruitFamily.Pome
    }
  }
}

