import { sbtTestLogEncodedEntries } from 'virtual:sbt-test-logs'

export interface LoadedTestLog {
  root: string
  exampleDir: string
  relPath: string
  text: string
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function listSbtTestLogs(): LoadedTestLog[] {
  return (sbtTestLogEncodedEntries ?? []).map((e) => ({
    root: e.root,
    exampleDir: e.exampleDir,
    relPath: e.relPath,
    text: decodeUtf8Base64(e.b64),
  }))
}

export function getSbtTestLogFor(root: string, exampleDir: string): LoadedTestLog | null {
  return listSbtTestLogs().find((l) => l.root === root && l.exampleDir === exampleDir) ?? null
}

