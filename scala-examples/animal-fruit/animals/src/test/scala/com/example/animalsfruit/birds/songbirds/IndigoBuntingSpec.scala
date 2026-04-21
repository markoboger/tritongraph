package com.example.animalsfruit.birds.songbirds

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class IndigoBuntingSpec extends AnyWordSpec with Matchers {
  "IndigoBunting" should {
    "support both stdlib values and cross-package artefacts in its constructor" in {
      val b = new IndigoBunting(
        wingspanCm = 20.0,
        observer = "field-notes",
        flockSize = 3,
        acceptedGift = Some(Fruit.Grape("concord")),
        lastSeenAt = Try((47.0, -122.0)),
      )
      b.commonLabel shouldBe "indigo bunting"
      b.songComplexity shouldBe 7
      b.flockSize shouldBe 3
      b.acceptedGift.map(_.label) shouldBe Some("concord grape")
      b.lastSeenAt.get._1 shouldBe 47.0
    }
  }
}

