package com.example.animalsfruit.relation

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class MealRecordSpec extends AnyWordSpec with Matchers {
  "MealRecord" should {
    "default notes to None and preserve food as Produce" in {
      val m = MealRecord(eaterCommonName = "red fox", food = Fruit.Orange)
      m.notes shouldBe None
      m.food.label shouldBe "orange"
    }
  }
}

