import { scoverageReportEncodedEntries } from 'virtual:scoverage-reports'

export interface LoadedScoverageReport {
  root: string
  exampleDir: string
  relPath: string
  xml: string
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function getScoverageReportFor(root: string, exampleDir: string): LoadedScoverageReport | null {
  const hit = (scoverageReportEncodedEntries ?? []).find((e) => e.root === root && e.exampleDir === exampleDir)
  if (!hit) return null
  return { root: hit.root, exampleDir: hit.exampleDir, relPath: hit.relPath, xml: decodeUtf8Base64(hit.b64) }
}

