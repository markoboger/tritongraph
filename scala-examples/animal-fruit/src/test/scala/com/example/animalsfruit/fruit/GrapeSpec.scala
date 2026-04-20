package com.example.animalsfruit.fruit

import com.example.animalsfruit.fruit.Fruit.Grape
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class GrapeSpec extends AnyWordSpec with Matchers {
  "Fruit.Grape" should {
    "format its label and report its family" in {
      val g = Grape("concord")
      g.label shouldBe "concord grape"
      g.family shouldBe FruitFamily.Berry
    }
  }
}

