package com.example.animalsfruit.mammals.carnivores

import com.example.animalsfruit.fruit.Fruit
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

final class TigerSpec extends AnyWordSpec with Matchers {
  "Tiger" should {
    "carry constructor values including Option and Try" in {
      val t = new Tiger(
        stripeCount = 100,
        subspecies = "siberian",
        territoryKm2 = Try(120),
        knownAs = None,
        snack = Some(Fruit.Banana(0.8)),
      )
      t.commonLabel shouldBe "tiger"
      t.taxonOrder shouldBe "Carnivora"
      t.clawSharpness shouldBe 9
      t.subspecies shouldBe "siberian"
      t.territoryKm2.get shouldBe 120
      t.knownAs shouldBe None
      // Decimal separator may vary by locale (e.g. `0,80`), so assert stable prefix.
      t.snack.map(_.label).get should startWith("banana (curvature=")
    }
  }
}

