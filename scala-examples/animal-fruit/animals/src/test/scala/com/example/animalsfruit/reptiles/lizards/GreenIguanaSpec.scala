package com.example.animalsfruit.reptiles.lizards

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class GreenIguanaSpec extends AnyWordSpec with Matchers {
  "GreenIguana" should {
    "carry mixed constructor parameters and still be Autotomous" in {
      val i = new GreenIguana(
        snoutVentLengthCm = 42.0,
        nickname = "igu",
        baskingSpotC = Try(34.5),
        favoriteLeaf = Some("kale"),
        stolenSnack = Some(Fruit.Banana(0.4)),
      )
      i.commonLabel shouldBe "green iguana"
      i.covering shouldBe "keeled scales"
      i.canDropTail shouldBe true
      i.baskingSpotC.get shouldBe 34.5
      i.stolenSnack.map(_.family) shouldBe Some(com.example.animalsfruit.fruit.FruitFamily.Berry)
    }
  }
}

