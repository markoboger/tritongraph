import type { PythonExampleEntry } from '../python/pythonExampleDiagrams'
import type { CodeModel } from '../../../packages/triton-core/src/languageModel'
import type { PythonFileSummary } from '../../../packages/triton-core/src/pythonCodeModel'

export interface LoadedProject {
  codeModel: CodeModel
  summaries: { filePath: string; summary: PythonFileSummary }[]
  /** Python source roots the workspace was parsed with — reused to parse the base revision the same way. */
  pythonSourceRoots?: readonly string[]
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
  return { codeModel, summaries, pythonSourceRoots: roots }
}

/**
 * Parse a runtime workspace as it existed at a git base (default HEAD~1) into a CodeModel + summaries.
 * Fetches `/api/workspace/git-base-python` (one `git show` per file) and runs the same parsers as the
 * head loader, with the head's `pythonSourceRoots` so module ids line up. Powers the conformance
 * new-vs-legacy split (Phase 3): the base CodeModel is checked against the same target architecture.
 * Throws when the workspace has no git / no such base — the caller surfaces that as "no base to compare".
 */
export async function loadRuntimeWorkspaceBaseProject(
  runtimeBaseUrl: string,
  workspacePath: string,
  workspaceName: string,
  roots: readonly string[],
  base = 'HEAD~1',
): Promise<LoadedProject> {
  const url = new URL(`${runtimeBaseUrl.replace(/\/$/, '')}/api/workspace/git-base-python`)
  url.searchParams.set('workspacePath', workspacePath)
  url.searchParams.set('base', base)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`base request failed (${res.status})`)
  const body = (await res.json()) as {
    ok?: boolean
    error?: string
    pyFiles?: { relPath: string; source: string }[]
  }
  if (!body.ok) throw new Error(body.error || 'git_base_failed')
  const pyFiles = body.pyFiles ?? []
  if (!pyFiles.length) throw new Error(`No Python files found at ${base}.`)
  const [{ summarizePython }, { buildPythonCodeModelFromSummaries }] = await Promise.all([
    import('../python/parsePythonWithTreeSitter'),
    import('../../../packages/triton-core/src/pythonCodeModel'),
  ])
  const parsed = await Promise.all(
    pyFiles.map((f) => summarizePython(f.source, f.relPath, workspacePath, roots)),
  )
  const summaries = parsed.map((summary, i) => ({ filePath: pyFiles[i]!.relPath, summary }))
  const codeModel = buildPythonCodeModelFromSummaries(summaries, { name: `Python@${base}: ${workspaceName}` })
  return { codeModel, summaries, pythonSourceRoots: roots }
}

/** Workspace-relative `.py` paths changed since `base`, from `/api/workspace/git-diff` — scopes the LLM. */
export async function fetchChangedPythonFiles(
  runtimeBaseUrl: string,
  workspacePath: string,
  base = 'HEAD~1',
): Promise<Set<string>> {
  const url = new URL(`${runtimeBaseUrl.replace(/\/$/, '')}/api/workspace/git-diff`)
  url.searchParams.set('workspacePath', workspacePath)
  url.searchParams.set('base', base)
  const res = await fetch(url.toString())
  if (!res.ok) return new Set()
  const body = (await res.json()) as { ok?: boolean; files?: { path?: string }[] }
  const out = new Set<string>()
  for (const f of body.files ?? []) {
    const p = String(f.path || '').trim()
    if (p.endsWith('.py')) out.add(p)
  }
  return out
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
