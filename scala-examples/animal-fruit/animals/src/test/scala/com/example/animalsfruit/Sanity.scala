package com.example.animalsfruit

import org.scalatest.wordspec.AnyWordSpec
import org.scalatest.matchers.should.Matchers

final class SanitySpec extends AnyWordSpec with Matchers {
  "The test suite" should {
    "load ScalaTest and run" in {
      1 + 1 shouldBe 2
    }
  }
}
