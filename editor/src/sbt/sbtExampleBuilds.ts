import { parseBuildSbt } from './parseBuildSbt'
import { sbtProjectsToIlographDocument } from './sbtProjectsToIlographDocument'
import { stringifyIlographYaml } from '../ilograph/parse'
import { sbtExampleEncodedEntries } from 'virtual:sbt-examples'

export interface SbtExampleEntry {
  /** Folder name under repo `sbt-examples` (e.g. multi-module example). */
  dir: string
  /** Logical path for display / status */
  path: string
  source: string
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Populated at build time from each repo sbt-examples subfolder build.sbt (see vite-plugin-sbt-examples.ts). */
export function listSbtExamples(): SbtExampleEntry[] {
  const rows = sbtExampleEncodedEntries ?? []
  return rows.map((e) => ({
    dir: e.dir,
    path: `sbt-examples/${e.dir}/build.sbt`,
    source: decodeUtf8Base64(e.b64),
  }))
}

export function sbtExampleSourceToYaml(dir: string, source: string): string {
  const projects = parseBuildSbt(source)
  const doc = sbtProjectsToIlographDocument(projects, {
    title: `sbt build: ${dir}`,
    sourcePath: `sbt-examples/${dir}/build.sbt`,
  })
  return stringifyIlographYaml(doc)
}
