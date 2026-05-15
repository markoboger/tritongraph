import type { IlographDocument } from '../ilograph/types'
import {
  buildScalaPackageGraph,
  scalaPackageGraphToIlographDocument,
  type ScalaPackageGraph,
} from '../scala/scalaPackagesToIlograph'
import type { LoadedScalaFile } from '../scala/scalaSourceLoader'

export interface ScalaParseResult {
  graph: ScalaPackageGraph
  doc: IlographDocument
}

/**
 * Parse Scala source files into a package graph and the corresponding Ilograph document.
 * Returns both so the caller can pass `graph` to overlay-data builders (coverage, docs, specs).
 */
export async function parseScalaFilesToDoc(
  files: readonly LoadedScalaFile[],
  meta: { title?: string; sourcePath?: string } = {},
): Promise<ScalaParseResult> {
  const graph = await buildScalaPackageGraph(files)
  const doc = scalaPackageGraphToIlographDocument(graph, meta)
  return { graph, doc }
}
