package com.example.animalsfruit.fruit

/**
 * Ripeness as a Scala 3 `enum`.
 * It’s small, but it gives the parser a canonical modern Scala enum construct.
 */
enum Ripeness {
  case Green, Ripe, Overripe
}

/**
 * Marker for anything that can appear on a menu or in a habitat.
 * We keep it intentionally tiny: a single `label` is enough to hang relationships off.
 */
trait Produce {
  def label: String
}

/**
 * Closed set of fruit kinds (sealed ADT — common Scala alternative to enums).
 * Each fruit knows its family so the parser sees cross-file references (`FruitFamily`).
 */
sealed trait Fruit extends Produce {
  def family: FruitFamily
}

/**
 * Fruit constructors live in a companion `object` to show nested artefacts.
 * The case classes are small but have enough surface area to be referenced from other packages.
 */
object Fruit {

  /** An apple is described by a variety and a ripeness level. */
  final case class Apple(variety: String, ripeness: Ripeness) extends Fruit {
    def label: String = s"$variety apple (${ripeness.toString.toLowerCase})"
    def family: FruitFamily = FruitFamily.Pome
  }

  /**
   * A banana uses formatted output in its label so the resulting string is not a trivial constant.
   * Locale can influence the decimal separator, which is useful for test realism.
   */
  final case class Banana(curvature: Double) extends Fruit {
    def label: String = f"banana (curvature=$curvature%.2f)"
    def family: FruitFamily = FruitFamily.Berry
  }

  /** Grapes are tiny, but we keep a `color` field so other code can reference it. */
  final case class Grape(color: String) extends Fruit {
    def label: String = s"$color grape"
    def family: FruitFamily = FruitFamily.Berry
  }

  /** A cherry has a made-up sweetness score; it's just enough to produce a distinctive label. */
  final case class Cherry(sweetness: Int) extends Fruit {
    def label: String = s"cherry (sweetness=$sweetness)"
    def family: FruitFamily = FruitFamily.Berry
  }

  /**
   * Singleton fruit example.
   * Case objects show up a lot in idiomatic Scala, so we include one here.
   */
  case object Orange extends Fruit {
    def label: String = "orange"
    def family: FruitFamily = FruitFamily.Citrus
  }
}

/**
 * Basket as a singleton object holding state (object body, lazy vals).
 * This models “available values today” without introducing IO, files, or databases.
 */
object SnackBasket {
  lazy val today: Seq[Fruit] =
    Seq(
      Fruit.Apple("Granny Smith", Ripeness.Green),
      Fruit.Banana(0.42),
      Fruit.Grape("concord"),
      Fruit.Cherry(7),
      Fruit.Orange,
    )
}
