package com.example.animalsfruit.reptiles

import com.example.animalsfruit.reptiles.snakes.BallPython
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class ReptileSpec extends AnyWordSpec with Matchers {
  "Reptile" should {
    "be ectothermic and expose covering via subclasses" in {
      val r: Reptile = new BallPython(lengthM = 1.0, morph = "classic")
      r.ectothermic shouldBe true
      r.covering shouldBe "smooth scales"
    }
  }
}

