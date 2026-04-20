package com.example.animalsfruit.mammals.carnivores

import com.example.animalsfruit.fruit.{Fruit, Ripeness}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class LionSpec extends AnyWordSpec with Matchers {
  "Lion" should {
    "expose Mammal metadata and CarnivoreHunter mixin behavior" in {
      val l = new Lion(
        prideSize = 6,
        nickname = "Simba",
        tagId = Some("L-9"),
        lastWeighedKg = Try(201.5),
        favoriteFruit = Some(Fruit.Apple("Gala", Ripeness.Ripe)),
      )
      l.isWarmBlooded shouldBe true
      l.taxonOrder shouldBe "Carnivora"
      l.commonLabel shouldBe "lion"
      l.clawSharpness shouldBe 9
      l.favoriteFruit.map(_.family) shouldBe Some(com.example.animalsfruit.fruit.FruitFamily.Pome)
    }

    "allow same-package artefacts as constructor arguments (rival Tiger)" in {
      val t = new Tiger(stripeCount = 42)
      val l = new Lion(prideSize = 2, rival = Some(t))
      l.rival.map(_.commonLabel) shouldBe Some("tiger")
    }
  }
}

