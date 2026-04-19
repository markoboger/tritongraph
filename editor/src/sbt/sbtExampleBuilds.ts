import { parseBuildSbt } from './parseBuildSbt'
import { sbtProjectsToIlographDocument } from './sbtProjectsToIlographDocument'
import { stringifyIlographYaml } from '../ilograph/parse'
import { sbtExampleEncodedEntries } from 'virtual:sbt-examples'

export interface SbtExampleEntry {
  /** Logical examples-root name (`sbt-examples`, `scala-examples`, …). */
  root: string
  /** Folder name under `root` (e.g. `01-single-module`, `animal-fruit`). */
  dir: string
  /** Logical path for display / status (`<root>/<dir>/build.sbt`). */
  path: string
  source: string
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Populated at build time from each registered examples-root's `<root>/<dir>/build.sbt`
 * (see `vite-plugin-sbt-examples.ts`). Entries are namespaced by `root` so leaf collisions across
 * folders (e.g. an `animal-fruit` in two roots) stay distinct.
 */
export function listSbtExamples(): SbtExampleEntry[] {
  const rows = sbtExampleEncodedEntries ?? []
  return rows.map((e) => ({
    root: e.root,
    dir: e.dir,
    path: `${e.root}/${e.dir}/build.sbt`,
    source: decodeUtf8Base64(e.b64),
  }))
}

export interface SbtExampleYamlOptions {
  /** Subproject ids (the `lazy val` name) that have at least one `.scala` file under their baseDir. */
  projectsWithScalaSources?: ReadonlySet<string>
}

export function sbtExampleSourceToYaml(
  root: string,
  dir: string,
  source: string,
  options: SbtExampleYamlOptions = {},
): string {
  const projects = parseBuildSbt(source)
  const doc = sbtProjectsToIlographDocument(projects, {
    title: `sbt build: ${dir}`,
    sourcePath: `${root}/${dir}/build.sbt`,
    projectsWithScalaSources: options.projectsWithScalaSources,
  })
  return stringifyIlographYaml(doc)
}
