package com.example.animalsfruit.fruit

import com.example.animalsfruit.fruit.Fruit.Orange
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class OrangeSpec extends AnyWordSpec with Matchers {
  "Fruit.Orange" should {
    "be a singleton fruit with a label" in {
      Orange.label shouldBe "orange"
      Orange.family shouldBe FruitFamily.Citrus
    }
  }
}

