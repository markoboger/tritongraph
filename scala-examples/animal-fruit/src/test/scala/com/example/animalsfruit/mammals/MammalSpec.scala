package com.example.animalsfruit.mammals

import com.example.animalsfruit.mammals.carnivores.Lion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

final class MammalSpec extends AnyWordSpec with Matchers {
  "Mammal" should {
    "be warm-blooded and expose its taxon order via subclasses" in {
      val m: Mammal = new Lion(prideSize = 1)
      m.isWarmBlooded shouldBe true
      m.taxonOrder shouldBe "Carnivora"
    }
  }
}

