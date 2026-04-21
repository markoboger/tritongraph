package com.example.animalsfruit.mammals.herbivores

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class ZebraSpec extends AnyWordSpec with Matchers {
  "Zebra" should {
    "carry various stdlib and cross-package constructor parameters" in {
      val z = new Zebra(
        stripeParity = "even",
        individualId = "Z-1",
        foalCount = 1,
        waterhole = Some("east-pool"),
        lastVetVisitDaysAgo = Try(9),
        offeredFruit = Some(Fruit.Grape("red")),
      )
      z.commonLabel shouldBe "plains zebra"
      z.taxonOrder shouldBe "Perissodactyla"
      z.minHerdSize shouldBe 12
      z.waterhole shouldBe Some("east-pool")
      z.lastVetVisitDaysAgo.get shouldBe 9
      z.offeredFruit.map(_.label) shouldBe Some("red grape")
    }
  }
}

