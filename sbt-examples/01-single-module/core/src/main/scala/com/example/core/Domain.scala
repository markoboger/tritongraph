package com.example.core

/** Core business abstractions shared across modules. */
object Domain {
  final case class UserId(value: String) extends AnyVal

  sealed trait DomainError extends Product with Serializable
  object DomainError {
    final case class Validation(message: String) extends DomainError
  }

  trait Validator[A] {
    def validate(a: A): Either[DomainError, A]
  }
}

