package com.example.animalsfruit.reptiles.lizards

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class LeopardGeckoSpec extends AnyWordSpec with Matchers {
  "LeopardGecko" should {
    "expose reptile fields and Autotomous behavior" in {
      val g = new LeopardGecko(
        pattern = "high-yellow",
        morphName = "tangerine",
        hatchYear = 2022,
        keeperNotes = Some("calm"),
        lastShedDaysAgo = Try(10),
        offeredFruit = Some(Fruit.Orange),
      )
      g.commonLabel shouldBe "leopard gecko"
      g.covering shouldBe "granular scales"
      g.ectothermic shouldBe true
      g.canDropTail shouldBe true
      g.lastShedDaysAgo.get shouldBe 10
      g.offeredFruit.map(_.label) shouldBe Some("orange")
    }
  }
}

