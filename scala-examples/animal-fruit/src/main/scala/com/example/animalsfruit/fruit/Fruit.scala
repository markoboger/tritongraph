package com.example.animalsfruit.fruit

/** Ripeness as classic Scala [[Enumeration]] (parser-friendly “enum-like” surface). */
object Ripeness extends Enumeration {
  val Green, Ripe, Overripe: Value = Value
}

/** Marker for anything that can appear on a menu or in a habitat. */
trait Produce {
  def label: String
}

/** Closed set of fruit kinds (sealed ADT — common Scala alternative to enums). */
sealed trait Fruit extends Produce {
  def family: FruitFamily.Value
}

object Fruit {

  final case class Apple(variety: String, ripeness: Ripeness.Value) extends Fruit {
    def label: String = s"$variety apple (${ripeness.toString.toLowerCase})"
    def family: FruitFamily.Value = FruitFamily.Pome
  }

  final case class Banana(curvature: Double) extends Fruit {
    def label: String = f"banana (curvature=$curvature%.2f)"
    def family: FruitFamily.Value = FruitFamily.Berry
  }

  final case class Grape(color: String) extends Fruit {
    def label: String = s"$color grape"
    def family: FruitFamily.Value = FruitFamily.Berry
  }

  final case class Cherry(sweetness: Int) extends Fruit {
    def label: String = s"cherry (sweetness=$sweetness)"
    def family: FruitFamily.Value = FruitFamily.Berry
  }

  case object Orange extends Fruit {
    def label: String = "orange"
    def family: FruitFamily.Value = FruitFamily.Citrus
  }
}

/** Basket as a singleton object holding state (object body, lazy vals). */
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
