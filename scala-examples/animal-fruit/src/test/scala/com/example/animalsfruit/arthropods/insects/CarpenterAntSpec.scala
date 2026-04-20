package com.example.animalsfruit.arthropods.insects

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class CarpenterAntSpec extends AnyWordSpec with Matchers {
  "CarpenterAnt" should {
    "implement Arthropod and keep nested cross-package artefacts" in {
      val a = new CarpenterAnt(
        colonySize = 1500,
        nestTree = "oak",
        queenPresent = true,
        observedForagingFruit = Some(Fruit.Grape("concord")),
        humidityPct = Try(60),
      )
      a.commonLabel shouldBe "carpenter ant"
      a.segmentCount shouldBe 3
      a.colonySize shouldBe 1500
      a.humidityPct.get shouldBe 60
      a.observedForagingFruit.map(_.label) shouldBe Some("concord grape")
    }
  }
}

