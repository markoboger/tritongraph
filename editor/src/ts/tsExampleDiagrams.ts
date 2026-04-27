import { tsExampleEncodedEntries } from 'virtual:ts-examples'

export interface TsExampleEntry {
  root: string
  dir: string
  file: string
  /** Logical path for display / status (`<root>/<dir>/<file>`). */
  path: string
  source: string
  /** Source files keyed by path relative to `<root>/<dir>` (e.g. `src/animals/Dog.ts`). */
  files: Record<string, string>
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function listTsExamples(): TsExampleEntry[] {
  const rows = tsExampleEncodedEntries ?? []
  return rows.map((e) => ({
    root: e.root,
    dir: e.dir,
    file: e.file,
    path: `${e.root}/${e.dir}/${e.file}`,
    source: decodeUtf8Base64(e.b64),
    files: Object.fromEntries(
      Object.entries((e.filesB64 ?? {}) as Record<string, string>).map(([k, v]) => [k, decodeUtf8Base64(v)]),
    ),
  }))
}

