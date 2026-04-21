package com.example.animalsfruit.birds.songbirds

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class WinterWrenSpec extends AnyWordSpec with Matchers {
  "WinterWren" should {
    "implement Songbird and carry Option/Try/cross-package fields" in {
      val w = new WinterWren(
        wingspanCm = 15.0,
        territoryName = "cedar thicket",
        ring = Some(12),
        lastSongNotes = Try(Vector("ti", "trill")),
        berrySnack = Some(Fruit.Cherry(9)),
      )
      w.commonLabel shouldBe "winter wren"
      w.songComplexity shouldBe 10
      w.ring shouldBe Some(12)
      w.lastSongNotes.get should contain("trill")
      w.berrySnack.map(_.label) shouldBe Some("cherry (sweetness=9)")
    }
  }
}

