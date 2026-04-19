/// <reference types="vite/client" />

declare module 'virtual:sbt-examples' {
  export interface SbtExampleEncoded {
    /** Logical examples-root name (`sbt-examples`, `scala-examples`, …). */
    root: string
    /** Top-level example dir under `root` (e.g. `01-single-module`, `animal-fruit`). */
    dir: string
    b64: string
  }
  export const sbtExampleEncodedEntries: SbtExampleEncoded[]
}

declare module 'virtual:scala-sources' {
  export interface ScalaSourceEncoded {
    /** Logical examples-root name (matches `virtual:sbt-examples` entries). */
    root: string
    /** Top-level example dir under `root` (e.g. `01-single-module`, `animal-fruit`). */
    exampleDir: string
    /** Path relative to `<root>/<exampleDir>` (e.g. `core/src/main/scala/com/example/core/Domain.scala`). */
    relPath: string
    /** UTF-8 source contents, base64-encoded. */
    b64: string
  }
  export const scalaSourceEncodedEntries: ScalaSourceEncoded[]
}
