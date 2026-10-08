import type { PythonExampleEntry } from '../python/pythonExampleDiagrams'
import { setDiffRangeParams, type DiffRange } from './diffRange'
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
 * `ref` reads the sources at that git ref instead of the working tree.
 */
export async function loadRuntimeWorkspaceProject(
  runtimeBaseUrl: string,
  workspacePath: string,
  workspaceName: string,
  ref = '',
): Promise<LoadedProject> {
  const url = new URL(`${runtimeBaseUrl.replace(/\/$/, '')}/api/workspace/bundle`)
  url.searchParams.set('workspacePath', workspacePath)
  if (ref) url.searchParams.set('ref', ref)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`bundle request failed (${res.status})`)
  const body = (await res.json()) as {
    ok?: boolean
    error?: string
    detail?: string
    pyFiles?: { relPath: string; source: string }[]
    pythonSourceRoots?: string[]
  }
  if (!body.ok) throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error || 'bundle_failed')
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
 * Parse a runtime workspace at the start of a diff range (the merge-base in PR mode) into a CodeModel +
 * summaries. Fetches `/api/workspace/git-base-python` (one `git show` per file) and runs the same
 * parsers as the head loader, with the head's `pythonSourceRoots` so module ids line up. Powers the
 * conformance new-vs-legacy split (Phase 3): the base CodeModel is checked against the same target
 * architecture. Throws when the workspace has no git / no such ref — the caller surfaces the message.
 */
export async function loadRuntimeWorkspaceBaseProject(
  runtimeBaseUrl: string,
  workspacePath: string,
  workspaceName: string,
  roots: readonly string[],
  range: DiffRange,
): Promise<LoadedProject> {
  const url = new URL(`${runtimeBaseUrl.replace(/\/$/, '')}/api/workspace/git-base-python`)
  url.searchParams.set('workspacePath', workspacePath)
  setDiffRangeParams(url, range)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`base request failed (${res.status})`)
  const body = (await res.json()) as {
    ok?: boolean
    error?: string
    detail?: string
    from?: string
    pyFiles?: { relPath: string; source: string }[]
  }
  if (!body.ok) throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error || 'git_base_failed')
  const pyFiles = body.pyFiles ?? []
  const baseLabel = body.from?.slice(0, 7) ?? range.base
  if (!pyFiles.length) throw new Error(`No Python files found at ${baseLabel}.`)
  const [{ summarizePython }, { buildPythonCodeModelFromSummaries }] = await Promise.all([
    import('../python/parsePythonWithTreeSitter'),
    import('../../../packages/triton-core/src/pythonCodeModel'),
  ])
  const parsed = await Promise.all(
    pyFiles.map((f) => summarizePython(f.source, f.relPath, workspacePath, roots)),
  )
  const summaries = parsed.map((summary, i) => ({ filePath: pyFiles[i]!.relPath, summary }))
  const codeModel = buildPythonCodeModelFromSummaries(summaries, { name: `Python@${baseLabel}: ${workspaceName}` })
  return { codeModel, summaries, pythonSourceRoots: roots }
}

/** Workspace-relative `.py` paths changed in the diff range, from `/api/workspace/git-diff` — scopes the LLM. */
export async function fetchChangedPythonFiles(
  runtimeBaseUrl: string,
  workspacePath: string,
  range: DiffRange,
): Promise<Set<string>> {
  const url = new URL(`${runtimeBaseUrl.replace(/\/$/, '')}/api/workspace/git-diff`)
  url.searchParams.set('workspacePath', workspacePath)
  setDiffRangeParams(url, range)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`git-diff request failed (${res.status})`)
  const body = (await res.json()) as { ok?: boolean; error?: string; detail?: string; files?: { path?: string }[] }
  // Throw rather than return an empty set: that would silently skip the LLM check.
  if (!body.ok) throw new Error(body.detail ? `${body.error}: ${body.detail}` : body.error || 'git_diff_failed')
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

/** The saved target-architecture YAML for a workspace, or null if none has been saved yet. */
export async function fetchTargetTopologyYaml(
  runtimeBaseUrl: string,
  workspacePath: string,
): Promise<string | null> {
  const url = new URL(`${runtimeBaseUrl.replace(/\/$/, '')}/api/workspace/target-topology`)
  url.searchParams.set('workspacePath', workspacePath)
  const res = await fetch(url.toString())
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`target-topology request failed (${res.status})`)
  const body = (await res.json()) as { ok?: boolean; yaml?: string }
  if (!body.ok || typeof body.yaml !== 'string') return null
  return body.yaml
}

/** Persist the target-architecture YAML for a workspace to `<workspace>/.triton/target.ilograph.yaml`. */
export async function saveTargetTopologyYaml(
  runtimeBaseUrl: string,
  workspacePath: string,
  yaml: string,
): Promise<void> {
  const res = await fetch(`${runtimeBaseUrl.replace(/\/$/, '')}/api/workspace/target-topology`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspacePath, yaml }),
  })
  const body = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || !body.ok) throw new Error(body.error || `target-topology save failed (${res.status})`)
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
