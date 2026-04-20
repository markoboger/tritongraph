package com.example.animalsfruit.reptiles.snakes

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class EasternRacerSpec extends AnyWordSpec with Matchers {
  "EasternRacer" should {
    "store sightings and optional snack" in {
      val r = new EasternRacer(
        maxSpeedKmh = 35.0,
        nickname = "zip",
        sightings = List((1.0, 2.0), (3.0, 4.0)),
        tailMark = Some("white-tip"),
        lastSnack = Some(Fruit.Grape("red")),
      )
      r.commonLabel shouldBe "eastern racer"
      r.covering shouldBe "smooth scales"
      r.sightings.length shouldBe 2
      r.tailMark shouldBe Some("white-tip")
      r.lastSnack.map(_.label) shouldBe Some("red grape")
    }
  }
}

