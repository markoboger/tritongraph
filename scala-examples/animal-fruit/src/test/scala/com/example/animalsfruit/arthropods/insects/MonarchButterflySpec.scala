package com.example.animalsfruit.arthropods.insects

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class MonarchButterflySpec extends AnyWordSpec with Matchers {
  "MonarchButterfly" should {
    "implement WingedInsect and expose its values" in {
      val m = new MonarchButterfly(
        migrationKm = 4000.0,
        tag = Some("MB-1"),
        generation = 4,
        nectarSource = Some(Fruit.Orange),
        windAssistKmh = Try(12.0),
      )
      m.commonLabel shouldBe "monarch butterfly"
      m.segmentCount shouldBe 3
      m.wingPairs shouldBe 1
      m.windAssistKmh.get shouldBe 12.0
      m.nectarSource.map(_.label) shouldBe Some("orange")
    }
  }
}

