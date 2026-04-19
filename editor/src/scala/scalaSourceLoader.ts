import { scalaSourceEncodedEntries } from 'virtual:scala-sources'

export interface LoadedScalaFile {
  /** Logical examples-root name (`sbt-examples`, `scala-examples`, …). */
  root: string
  /** Top-level example dir under `root` (e.g. `01-single-module`, `animal-fruit`). */
  exampleDir: string
  /** Path relative to `<root>/<exampleDir>` (POSIX-style separators). */
  relPath: string
  /** Decoded UTF-8 source. */
  source: string
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function listScalaSources(): LoadedScalaFile[] {
  return (scalaSourceEncodedEntries ?? []).map((e) => ({
    root: e.root,
    exampleDir: e.exampleDir,
    relPath: e.relPath,
    source: decodeUtf8Base64(e.b64),
  }))
}

/** Convenience filter for one `(root, exampleDir)` pair plus an optional sub-path prefix (e.g. `core/`). */
export function listScalaSourcesIn(
  root: string,
  exampleDir: string,
  subPathPrefix = '',
): LoadedScalaFile[] {
  const prefix = subPathPrefix.replace(/^\/+|\/+$/g, '')
  return listScalaSources().filter(
    (f) =>
      f.root === root &&
      f.exampleDir === exampleDir &&
      (!prefix || f.relPath === prefix || f.relPath.startsWith(`${prefix}/`)),
  )
}
