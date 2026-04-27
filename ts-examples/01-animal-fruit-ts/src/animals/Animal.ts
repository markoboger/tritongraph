/**
 * Minimal domain model for this example.
 *
 * `kind` is a discriminator used to keep unions simple in TypeScript.
 * `speak()` is included so classes can demonstrate functions in the diagram.
 */
export interface Animal {
  kind: 'animal'
  name: string
  speak(): string
}

