/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Default triton-runtime base URL when the page is not opened with `?runtimeUrl=`. */
  readonly VITE_TRITON_RUNTIME_URL?: string
}

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

declare module 'virtual:ts-examples' {
  export interface TsExampleScannerOptions {
    sourceRoot?: string
    modulePaths?: string[]
    ignoredPackageSegments?: string[]
    rootResourceKind?: 'package' | 'project'
  }

  export interface TsExampleEncoded {
    root: string
    /** Top-level example dir under `root` (e.g. `01-tritongraph-self`). */
    dir: string
    /** YAML file name inside `<root>/<dir>` (e.g. `repo-typescript-deps.ilograph.yaml`). */
    file: string
    b64: string
    /** Base64-encoded TS sources keyed by logical source path for the diagram. */
    filesB64?: Record<string, string | { b64: string; sourceFile?: string }>
    /** Optional analyzer/projection options parsed from the example YAML. */
    scannerOptions?: TsExampleScannerOptions
  }
  export const tsExampleEncodedEntries: TsExampleEncoded[]
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

declare module 'virtual:sbt-test-logs' {
  export interface SbtTestLogEncoded {
    root: string
    exampleDir: string
    relPath: string
    b64: string
  }
  export const sbtTestLogEncodedEntries: SbtTestLogEncoded[]
}

declare module 'virtual:scoverage-reports' {
  export interface ScoverageReportEncoded {
    root: string
    exampleDir: string
    relPath: string
    b64: string
  }
  export const scoverageReportEncodedEntries: ScoverageReportEncoded[]
}

declare module 'virtual:triton-config' {
  export interface TritonEditorConfig {
    /** Built-in preset shortcut (`cursor`, `vscode`, `vscode-insiders`, `idea`, `zed`). */
    name?: string
    /** Optional URL template overriding `name`. Placeholders: `{absPath}`, `{line}`, `{col}`. */
    urlTemplate?: string
  }
  export interface TritonConfig {
    editor: TritonEditorConfig
  }
  /** Absolute git-repo root (POSIX separators), used to resolve `relPath → absPath`. */
  export const repoRoot: string
  /** Merged `.triton.yaml` contents with defaults applied. */
  export const config: TritonConfig
}
