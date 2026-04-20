package com.example.animalsfruit.fruit

import com.example.animalsfruit.fruit.Fruit.Cherry
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class CherrySpec extends AnyWordSpec with Matchers {
  "Fruit.Cherry" should {
    "include sweetness in its label and report its family" in {
      val c = Cherry(7)
      c.label should include("sweetness=7")
      c.family shouldBe FruitFamily.Berry
    }
  }
}

