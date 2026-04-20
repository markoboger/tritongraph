package com.example.animalsfruit.birds.raptors

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class GoldenEagleSpec extends AnyWordSpec with Matchers {
  "GoldenEagle" should {
    "implement Bird via Raptor and expose constructor values" in {
      val e = new GoldenEagle(
        talonGripKg = 12.0,
        wingspanCm = 210.0,
        bandCode = Some("GE-7"),
        nestingCliff = "east face",
        lastDiveSpeedKmh = Try(155.0),
        cachedSnack = Some(Fruit.Orange),
      )
      e.commonLabel shouldBe "golden eagle"
      e.wingspanCm shouldBe 210.0
      e.talonGripKg shouldBe 12.0
      e.bandCode shouldBe Some("GE-7")
      e.lastDiveSpeedKmh.get shouldBe 155.0
      e.cachedSnack.map(_.label) shouldBe Some("orange")
    }
  }
}

