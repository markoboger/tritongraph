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

/**
 * Parse a runtime workspace (a local repository added via the runtime) into a CodeModel + summaries.
 * Fetches the workspace bundle from the runtime, then runs the same Python parsers as the example
 * loader — so the conformance checker can run against real repositories, not only bundled examples.
 */
export async function loadRuntimeWorkspaceProject(
  runtimeBaseUrl: string,
  workspacePath: string,
  workspaceName: string,
): Promise<LoadedProject> {
  const url = new URL(`${runtimeBaseUrl.replace(/\/$/, '')}/api/workspace/bundle`)
  url.searchParams.set('workspacePath', workspacePath)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`bundle request failed (${res.status})`)
  const body = (await res.json()) as {
    ok?: boolean
    error?: string
    pyFiles?: { relPath: string; source: string }[]
    pythonSourceRoots?: string[]
  }
  if (!body.ok) throw new Error(body.error || 'bundle_failed')
  const pyFiles = body.pyFiles ?? []
  if (!pyFiles.length) throw new Error('No Python files found in this workspace.')
  const roots = body.pythonSourceRoots ?? []
  const [{ summarizePython }, { buildPythonCodeModelFromSummaries }] = await Promise.all([
    import('../python/parsePythonWithTreeSitter'),
    import('../../../packages/triton-core/src/pythonCodeModel'),
  ])
  const parsed = await Promise.all(
    pyFiles.map((f) => summarizePython(f.source, f.relPath, workspacePath, roots)),
  )
  const summaries = parsed.map((summary, i) => ({ filePath: pyFiles[i]!.relPath, summary }))
  const codeModel = buildPythonCodeModelFromSummaries(summaries, { name: `Python: ${workspaceName}` })
  return { codeModel, summaries }
}

/** A repository the runtime knows about, for the conformance project picker. */
export interface RuntimeRepoOption {
  workspacePath: string
  workspaceName: string
}

/** Recent local repositories from the runtime home model, for the conformance repository picker. */
export async function fetchRuntimeRepos(runtimeBaseUrl: string): Promise<RuntimeRepoOption[]> {
  const res = await fetch(`${runtimeBaseUrl.replace(/\/$/, '')}/api/home`)
  if (!res.ok) return []
  const body = (await res.json()) as {
    recentRepos?: { workspacePath?: string; workspaceName?: string }[]
    courses?: { workspaces?: { workspacePath?: string; workspaceName?: string }[] }[]
  }
  const rows = [
    ...(body.recentRepos ?? []),
    ...(body.courses ?? []).flatMap((c) => c.workspaces ?? []),
  ]
  const seen = new Set<string>()
  const repos: RuntimeRepoOption[] = []
  for (const r of rows) {
    const workspacePath = String(r.workspacePath || '').trim()
    if (!workspacePath || seen.has(workspacePath)) continue
    seen.add(workspacePath)
    repos.push({
      workspacePath,
      workspaceName: String(r.workspaceName || '').trim() || workspacePath.split(/[\\/]/).filter(Boolean).pop() || 'workspace',
    })
  }
  return repos
}
