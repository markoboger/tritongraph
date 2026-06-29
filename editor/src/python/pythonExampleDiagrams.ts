import { pythonExampleEncodedEntries } from 'virtual:python-examples'

export interface PythonExampleEntry {
  root: string
  dir: string
  /** Display path: `<root>/<dir>` */
  path: string
  /** All `.py` files, keyed by path relative to `<root>/<dir>` (e.g. `clinic/animals/base.py`). */
  files: Record<string, string>
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function listPythonExamples(): PythonExampleEntry[] {
  return (pythonExampleEncodedEntries ?? []).map((e) => ({
    root: e.root,
    dir: e.dir,
    path: `${e.root}/${e.dir}`,
    files: Object.fromEntries(
      Object.entries(e.filesB64).map(([k, v]) => [k, decodeUtf8Base64(v)]),
    ),
  }))
}
