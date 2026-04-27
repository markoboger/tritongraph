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
  /** Optional real source path for each logical file, relative to `<root>/<dir>`. */
  sourceFiles: Record<string, string>
  scannerOptions?: {
    sourceRoot?: string
    modulePaths?: string[]
    ignoredPackageSegments?: string[]
    rootResourceKind?: 'package' | 'project'
  }
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
    ...(e.scannerOptions ? { scannerOptions: e.scannerOptions } : {}),
    ...(() => {
      const files: Record<string, string> = {}
      const sourceFiles: Record<string, string> = {}
      for (const [k, raw] of Object.entries(e.filesB64 ?? {})) {
        if (typeof raw === 'string') {
          files[k] = decodeUtf8Base64(raw)
          continue
        }
        files[k] = decodeUtf8Base64(raw.b64)
        if (raw.sourceFile) sourceFiles[k] = raw.sourceFile
      }
      return { files, sourceFiles }
    })(),
  }))
}

