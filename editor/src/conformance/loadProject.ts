import type { PythonExampleEntry } from '../python/pythonExampleDiagrams'
import type { CodeModel } from '../../../packages/triton-core/src/languageModel'
import type { PythonFileSummary } from '../../../packages/triton-core/src/pythonCodeModel'

export interface LoadedProject {
  codeModel: CodeModel
  summaries: { filePath: string; summary: PythonFileSummary }[]
}

/**
 * Parse a bundled Python example into a CodeModel + summaries via the existing editor parsers — the
 * same path `openPythonExampleTab` uses, factored out so the conformance subpage doesn't duplicate
 * App.vue. `summaries` feed `summaryToChangedFact` (the LLM facts); `codeModel` feeds the rule-engine
 * and topology derivation.
 */
export async function loadExampleProject(entry: PythonExampleEntry): Promise<LoadedProject> {
  const [{ summarizePython }, { buildPythonCodeModelFromSummaries }] = await Promise.all([
    import('../python/parsePythonWithTreeSitter'),
    import('../../../packages/triton-core/src/pythonCodeModel'),
  ])
  const fileEntries = Object.entries(entry.files).filter(([relPath]) => relPath.endsWith('.py'))
  const parsed = await Promise.all(
    fileEntries.map(([relPath, source]) => summarizePython(source, relPath, entry.path)),
  )
  const summaries = parsed.map((summary, i) => ({ filePath: fileEntries[i]![0], summary }))
  const codeModel = buildPythonCodeModelFromSummaries(summaries, { name: `Python: ${entry.dir}` })
  return { codeModel, summaries }
}
