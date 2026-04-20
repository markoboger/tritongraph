package com.example.animalsfruit.reptiles.snakes

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class BallPythonSpec extends AnyWordSpec with Matchers {
  "BallPython" should {
    "implement Constrictor and keep Try/Option values" in {
      val p = new BallPython(
        lengthM = 1.2,
        morph = "pastel",
        enclosureId = Some("rack-4"),
        lastMeal = Try("mouse"),
        temperatureC = Try(28.0),
        enrichmentFruit = Some(Fruit.Orange),
      )
      p.commonLabel shouldBe "ball python"
      p.covering shouldBe "smooth scales"
      p.coilPressurePsi shouldBe 30.0
      p.lastMeal.get shouldBe "mouse"
      p.enrichmentFruit.map(_.label) shouldBe Some("orange")
    }
  }
}

