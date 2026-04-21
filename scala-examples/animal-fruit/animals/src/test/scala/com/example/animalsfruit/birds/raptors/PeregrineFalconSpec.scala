package com.example.animalsfruit.birds.raptors

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class PeregrineFalconSpec extends AnyWordSpec with Matchers {
  "PeregrineFalcon" should {
    "provide a fixed talon grip and keep Try/Option fields" in {
      val f = new PeregrineFalcon(
        diveSpeedKmh = 300.0,
        wingspanCm = 105.0,
        nickname = "rocket",
        preyPreference = Some("pigeon"),
        travelLog = Try(List("ridge", "tower")),
        giftedFruit = Some(Fruit.Orange),
      )
      f.commonLabel shouldBe "peregrine falcon"
      f.talonGripKg shouldBe 5.5
      f.preyPreference shouldBe Some("pigeon")
      f.travelLog.get should contain("tower")
      f.giftedFruit.map(_.label) shouldBe Some("orange")
    }
  }
}

