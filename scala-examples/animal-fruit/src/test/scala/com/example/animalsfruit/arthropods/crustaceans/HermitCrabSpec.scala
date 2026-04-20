package com.example.animalsfruit.arthropods.crustaceans

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class HermitCrabSpec extends AnyWordSpec with Matchers {
  "HermitCrab" should {
    "preserve constructor values including Try and Option" in {
      val h = new HermitCrab(
        shellBorrowed = true,
        shellFrom = Some("whelk"),
        movedTimes = 2,
        lastHideout = Try("tidepool"),
        curiosityFruit = Some(Fruit.Cherry(8)),
      )
      h.commonLabel shouldBe "hermit crab"
      h.segmentCount shouldBe 2
      h.walkingLegPairs shouldBe 5
      h.shellBorrowed shouldBe true
      h.lastHideout.get shouldBe "tidepool"
      h.curiosityFruit.map(_.family) shouldBe Some(com.example.animalsfruit.fruit.FruitFamily.Berry)
    }
  }
}

