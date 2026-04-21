package com.example.animalsfruit.arthropods.crustaceans

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class BlueCrabSpec extends AnyWordSpec with Matchers {
  "BlueCrab" should {
    "implement Decapod defaults and expose its fields" in {
      val c = new BlueCrab(
        carapaceWidthCm = 18.0,
        bay = "chesapeake",
        moltCount = 3,
        salinityPpt = Try(14.5),
        baitFruit = Some(Fruit.Cherry(4)),
      )
      c.commonLabel shouldBe "blue crab"
      c.segmentCount shouldBe 2
      c.walkingLegPairs shouldBe 5
      c.salinityPpt.get shouldBe 14.5
      c.baitFruit.map(_.label) shouldBe Some("cherry (sweetness=4)")
    }
  }
}

