package com.example.animalsfruit.animal

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class VertebrateSpec extends AnyWordSpec with Matchers {
  "Vertebrate" should {
    "expose its speciesLabel constructor argument" in {
      val v = new Vertebrate("Testus exampleii")
      v.speciesLabel shouldBe "Testus exampleii"
    }
  }
}

