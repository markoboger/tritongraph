/// <reference types="vite/client" />

declare module 'virtual:sbt-examples' {
  export interface SbtExampleEncoded {
    dir: string
    b64: string
  }
  export const sbtExampleEncodedEntries: SbtExampleEncoded[]
}
