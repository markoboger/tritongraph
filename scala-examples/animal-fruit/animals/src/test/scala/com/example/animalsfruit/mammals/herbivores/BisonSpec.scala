package com.example.animalsfruit.mammals.herbivores

import com.example.animalsfruit.fruit.{Fruit, Ripeness}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class BisonSpec extends AnyWordSpec with Matchers {
  "Bison" should {
    "implement Grazer and expose its fields" in {
      val b = new Bison(
        rangeHa = 900.0,
        herdName = "north-herd",
        hornSpanCm = Some(70),
        trackerBatteryPct = Try(88),
        favorite = Some(Fruit.Apple("Cortland", Ripeness.Green)),
      )
      b.commonLabel shouldBe "american bison"
      b.minHerdSize shouldBe 8
      b.taxonOrder shouldBe "Artiodactyla"
      b.herdName shouldBe "north-herd"
      b.trackerBatteryPct.get shouldBe 88
      b.favorite.map(_.family) shouldBe Some(com.example.animalsfruit.fruit.FruitFamily.Pome)
    }
  }
}

