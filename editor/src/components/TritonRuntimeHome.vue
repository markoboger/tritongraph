<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { StarterCard, StarterCardKind } from '../triton/tritonStarterCard'

type StarterFoldSection = {
  id: 'scala' | 'ts' | 'sbt' | 'dojo' | 'docker'
  title: string
  hint: string
  cards: StarterCard[]
}
import stackedCubesIconUrl from '../assets/language-icons/stacked-cubes.svg'
import githubMarkIconUrl from '../assets/language-icons/Octicons-mark-github.svg'
import gitlabMarkIconUrl from '../assets/language-icons/GitLab_icon.svg'
import folderIconUrl from '../assets/language-icons/folder.svg'
import { dockerBrandIconUrl } from '../triton/dockerConceptIcons'
import cubeIconUrl from '../assets/language-icons/cube.svg'
import sbtIconUrl from '../assets/language-icons/sbt.svg'
import typescriptIconUrl from '../assets/language-icons/typescript.svg'
import genericIconUrl from '../assets/language-icons/generic.svg'

export type RuntimeHomeRepo = {
  workspacePath: string
  workspaceName: string
  probe?: { kind?: string }
  lastOpenedAt?: string
  /** Present when registered via hosted Git clone (`POST /api/analysis/github`). */
  source?: 'github' | 'gitlab'
  repositoryUrl?: string
  gitRef?: string
}

export type RuntimeCourse = {
  id: string
  slug: string
  title: string
  term?: string
  createdAt?: string
  workspaces?: RuntimeHomeRepo[]
}

export type RuntimeHomeModel = {
  ok?: boolean
  error?: string
  runtime?: {
    publicRuntimeUrl?: string
    editorUrl?: string
    allowedRepoRoots?: string[]
    gitCacheRoot?: string
    httpPathPrefix?: string
    persistenceBackend?: 'file' | 'postgres'
    version?: string
    capabilities?: string[]
  }
  /** Grouped workspaces; only present when the runtime advertises `courses-api`. */
  courses?: RuntimeCourse[]
  recentRepos?: RuntimeHomeRepo[]
}

/** Query-driven IDE link (extension / internal server opens the editor with these params). */
export type TritonIdeSession = {
  ideName: string
  workspaceName: string
  activeFile: string
  ideOpenUrl: string
}

const props = withDefaults(
  defineProps<{
    /** Base URL of triton-runtime (no trailing slash), e.g. http://127.0.0.1:4317 */
    runtimeBaseUrl: string
    /** Bundled YAML / dojo / sbt / TS examples as home cards. */
    starterCards?: StarterCard[]
    /** Present when opened from an IDE with `ideOpenUrl` (and related) query params. */
    ideSession?: TritonIdeSession | null
    /** True when a workspace path is bound (URL or runtime tab) so runtime actions can run. */
    runtimeWorkspaceActive?: boolean
    /** Which runtime action is in flight (`''` when idle). */
    runtimeActionBusy?: string
    /** App status line (runtime actions, errors, hints). */
    statusMessage?: string
  }>(),
  {
    starterCards: () => [],
    ideSession: null,
    runtimeWorkspaceActive: false,
    runtimeActionBusy: '',
    statusMessage: '',
  },
)

const emit = defineEmits<{
  openSbt: [payload: { workspacePath: string; workspaceName: string }]
  openPackages: [payload: { workspacePath: string; workspaceName: string }]
  selectExample: [selectionId: string]
  runtimeWorkspaceAction: [payload: { action: 'refresh' | 'sbt-test' | 'sbt-coverage'; label: string }]
}>()

const workspacePathInput = ref('')
const githubUrlInput = ref('')
const githubRefInput = ref('')
/** Optional PAT for private repos; cleared after successful import (never stored on cards). */
const githubTokenInput = ref('')
const selectedCourseId = ref('')
const newCourseSlug = ref('')
const newCourseTitle = ref('')
const newCourseTerm = ref('')
const courseFormBusy = ref(false)
const courseSubmitError = ref('')
const deletingCourseId = ref('')
const courseDialogRef = ref<HTMLDialogElement | null>(null)
const localRepoDialogRef = ref<HTMLDialogElement | null>(null)
const remoteRepoDialogRef = ref<HTMLDialogElement | null>(null)
/** Tracks modal open state so course errors can show inline vs in-dialog without duplication. */
const courseDialogOpen = ref(false)
const homeModel = ref<RuntimeHomeModel | null>(null)
const loadError = ref('')
const submitError = ref('')
const githubSubmitError = ref('')
const cardError = ref('')
const formBusy = ref(false)
const githubFormBusy = ref(false)
const analyzingPath = ref('')
const syncingGithubPath = ref('')
const lastResultJson = ref('')
/** Repositories added from “Add new Repository” this session (shown first in the grid). */
const sessionRepos = ref<RuntimeHomeRepo[]>([])
/** Paths we know `/api/analysis/local` has succeeded for this session (or listed in recent). */
const locallyAnalyzedPaths = ref<Set<string>>(new Set())

const base = computed(() => props.runtimeBaseUrl.replace(/\/$/, ''))

function openCourseDialog(): void {
  courseSubmitError.value = ''
  courseDialogOpen.value = true
  void nextTick(() => courseDialogRef.value?.showModal())
}

function closeCourseDialog(): void {
  courseSubmitError.value = ''
  courseDialogRef.value?.close()
}

function openLocalRepoDialog(): void {
  submitError.value = ''
  lastResultJson.value = ''
  void nextTick(() => localRepoDialogRef.value?.showModal())
}

function closeLocalRepoDialog(): void {
  submitError.value = ''
  lastResultJson.value = ''
  localRepoDialogRef.value?.close()
}

function openRemoteRepoDialog(): void {
  githubSubmitError.value = ''
  lastResultJson.value = ''
  void nextTick(() => remoteRepoDialogRef.value?.showModal())
}

function closeRemoteRepoDialog(): void {
  githubSubmitError.value = ''
  lastResultJson.value = ''
  remoteRepoDialogRef.value?.close()
}

/** `/api/home` from builds without GitHub analysis omits `capabilities.analysis-github`. */
const runtimeSupportsGithubAnalysis = computed(() => {
  const caps = homeModel.value?.runtime?.capabilities
  return Array.isArray(caps) && caps.includes('analysis-github')
})

const githubRuntimeStaleWarning = computed(
  () =>
    !!(homeModel.value?.ok !== false &&
      homeModel.value?.runtime &&
      !runtimeSupportsGithubAnalysis.value),
)

const runtimeSupportsGithubSync = computed(() => {
  const caps = homeModel.value?.runtime?.capabilities
  return Array.isArray(caps) && caps.includes('github-sync')
})

const runtimeSupportsCourses = computed(() => {
  const caps = homeModel.value?.runtime?.capabilities
  return Array.isArray(caps) && caps.includes('courses-api')
})

/** Show the Courses block whenever we have a successful home payload (not gated on capability — older runtimes get an upgrade hint instead). */
const showCoursesSection = computed(() => !!homeModel.value?.runtime)

const hasCoursesForPicker = computed(() => (homeModel.value?.courses?.length ?? 0) > 0)

const assignedWorkspacePaths = computed(() => {
  const s = new Set<string>()
  for (const c of homeModel.value?.courses ?? []) {
    for (const w of c.workspaces ?? []) {
      const p = String(w.workspacePath || '').trim()
      if (p) s.add(p)
    }
  }
  return s
})

const orphanDeckTitle = computed(() =>
  assignedWorkspacePaths.value.size > 0 ? 'Other workspaces' : 'Repositories',
)

function markAnalyzed(path: string): void {
  const next = new Set(locallyAnalyzedPaths.value)
  next.add(path)
  locallyAnalyzedPaths.value = next
}

function wasOpenedOrAnalyzed(path: string): boolean {
  if (locallyAnalyzedPaths.value.has(path)) return true
  if (homeModel.value?.recentRepos?.some((r) => r.workspacePath === path)) return true
  for (const c of homeModel.value?.courses ?? []) {
    if (c.workspaces?.some((w) => w.workspacePath === path)) return true
  }
  return false
}

function pushSessionRepo(repo: RuntimeHomeRepo): void {
  sessionRepos.value = [
    { ...repo },
    ...sessionRepos.value.filter((r) => r.workspacePath !== repo.workspacePath),
  ]
}

function mergeFromHome(r: RuntimeHomeRepo): RuntimeHomeRepo {
  const fr = homeModel.value?.recentRepos?.find((x) => x.workspacePath === r.workspacePath)
  if (fr) {
    return {
      workspacePath: r.workspacePath,
      workspaceName: r.workspaceName || fr.workspaceName,
      lastOpenedAt: fr.lastOpenedAt || r.lastOpenedAt,
      probe: r.probe || fr.probe,
      source: fr.source ?? r.source,
      repositoryUrl: fr.repositoryUrl ?? r.repositoryUrl,
      gitRef: fr.gitRef ?? r.gitRef,
    }
  }
  for (const c of homeModel.value?.courses ?? []) {
    const cw = c.workspaces?.find((x) => x.workspacePath === r.workspacePath)
    if (cw) {
      return {
        workspacePath: r.workspacePath,
        workspaceName: r.workspaceName || cw.workspaceName,
        lastOpenedAt: cw.lastOpenedAt || r.lastOpenedAt,
        probe: r.probe || cw.probe,
        source: cw.source ?? r.source,
        repositoryUrl: cw.repositoryUrl ?? r.repositoryUrl,
        gitRef: cw.gitRef ?? r.gitRef,
      }
    }
  }
  return r
}

const repositoryCards = computed(() => {
  const seen = new Set<string>()
  const out: RuntimeHomeRepo[] = []
  const keepOrphan = (wsPath: string) => !assignedWorkspacePaths.value.has(wsPath)
  for (const r of sessionRepos.value) {
    if (!keepOrphan(r.workspacePath)) continue
    if (seen.has(r.workspacePath)) continue
    seen.add(r.workspacePath)
    out.push(mergeFromHome(r))
  }
  for (const r of homeModel.value?.recentRepos ?? []) {
    if (!keepOrphan(r.workspacePath)) continue
    if (seen.has(r.workspacePath)) continue
    seen.add(r.workspacePath)
    out.push(r)
  }
  return out
})

const starterCardList = computed(() => props.starterCards ?? [])

function sortStartersByTitle(cards: StarterCard[]): StarterCard[] {
  return [...cards].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
}

/** Foldable groups: Scala (scala-examples), TS, sbt (+ bundled YAML demo), dojos. */
const starterFoldSections = computed<StarterFoldSection[]>(() => {
  const all = starterCardList.value
  const scala = sortStartersByTitle(all.filter((c) => c.kind === 'sbt' && c.group === 'Scala (bundled)'))
  const ts = sortStartersByTitle(all.filter((c) => c.kind === 'ts'))
  const sbtPool = all.filter((c) => (c.kind === 'sbt' && c.group !== 'Scala (bundled)') || c.kind === 'yaml')
  const yaml = sbtPool.filter((c) => c.kind === 'yaml')
  const sbtOnly = sortStartersByTitle(sbtPool.filter((c) => c.kind === 'sbt'))
  const sbt = [...yaml, ...sbtOnly]
  const dojo = sortStartersByTitle(all.filter((c) => c.kind === 'dojo'))
  const docker = sortStartersByTitle(all.filter((c) => c.kind === 'docker'))

  const out: StarterFoldSection[] = []
  if (scala.length) {
    out.push({
      id: 'scala',
      title: 'Scala Examples',
      hint: 'Projects under scala-examples — open the sbt build or package diagram from each card.',
      cards: scala,
    })
  }
  if (ts.length) {
    out.push({
      id: 'ts',
      title: 'TS Examples',
      hint: 'Bundled ts-examples workspaces (Ilograph + TypeScript sources).',
      cards: ts,
    })
  }
  if (sbt.length) {
    out.push({
      id: 'sbt',
      title: 'SBT Examples',
      hint: 'sbt-examples tutorial and large OSS builds, plus the bundled five-layer YAML demo.',
      cards: sbt,
    })
  }
  if (dojo.length) {
    out.push({
      id: 'dojo',
      title: 'Dojos',
      hint: 'Interactive diagrams for layouts, package views, and UI experiments.',
      cards: dojo,
    })
  }
  if (docker.length) {
    out.push({
      id: 'docker',
      title: 'Docker Examples',
      hint: 'Compose and Dockerfile concepts mapped to Ilograph diagrams (with runnable compose files in-repo).',
      cards: docker,
    })
  }
  return out
})

const starterCardTotal = computed(() => starterFoldSections.value.reduce((n, s) => n + s.cards.length, 0))

const trimmedStatus = computed(() => (props.statusMessage ?? '').trim())

const showContextBar = computed(
  () => !!(props.ideSession || props.runtimeWorkspaceActive || trimmedStatus.value),
)

function onRuntimeWorkspaceAction(action: 'refresh' | 'sbt-test' | 'sbt-coverage', label: string): void {
  emit('runtimeWorkspaceAction', { action, label })
}

function starterIconUrl(card: StarterCard): string {
  switch (card.kind) {
    case 'dojo':
      return cubeIconUrl
    case 'yaml':
      return genericIconUrl
    case 'sbt':
      return sbtIconUrl
    case 'ts':
      return typescriptIconUrl
    case 'docker':
      return dockerBrandIconUrl
  }
}

function starterKindLabel(kind: StarterCardKind): string {
  switch (kind) {
    case 'dojo':
      return 'Dojo'
    case 'yaml':
      return 'YAML'
    case 'sbt':
      return 'SBT'
    case 'ts':
      return 'TypeScript'
    case 'docker':
      return 'Docker'
  }
}

function openStarter(card: StarterCard): void {
  emit('selectExample', card.selectionId)
}

function isSessionListed(repo: RuntimeHomeRepo): boolean {
  return sessionRepos.value.some((r) => r.workspacePath === repo.workspacePath)
}

async function fetchHome(): Promise<void> {
  loadError.value = ''
  try {
    const res = await fetch(`${base.value}/api/home`)
    const body = (await res.json()) as RuntimeHomeModel
    if (!res.ok || body.ok === false) {
      throw new Error(body.error || `Failed to load runtime home (${res.status}).`)
    }
    homeModel.value = body
  } catch (e) {
    homeModel.value = null
    loadError.value = e instanceof Error ? e.message : String(e)
  }
}

type AnalysisOk = {
  ok: true
  workspacePath: string
  workspaceName: string
  probe?: { kind?: string }
  repositoryUrl?: string
  gitRef?: string
}
type AnalysisFail = { ok: false; error: string; body?: Record<string, unknown> }

async function postGithubAnalysis(
  repoUrl: string,
  ref: string,
  githubToken?: string,
  courseId?: string,
): Promise<AnalysisOk | AnalysisFail> {
  const url = repoUrl.trim()
  lastResultJson.value = ''
  if (!url) {
    return { ok: false, error: 'Please enter an HTTPS repository URL (GitHub or GitLab).' }
  }
  try {
    const payload: Record<string, string> = { repositoryUrl: url, ref: ref.trim() }
    const tok = String(githubToken || '').trim()
    if (tok) {
      payload.gitToken = tok
      payload.githubToken = tok
    }
    const cid = String(courseId || '').trim()
    if (cid) payload.courseId = cid
    const res = await fetch(`${base.value}/api/analysis/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || body.ok !== true) {
      return {
        ok: false,
        error: String(body.error || `Request failed (${res.status}).`),
        body,
      }
    }
    const workspaceName = String(body.workspaceName || '').trim() || 'workspace'
    const wsPath = String(body.workspacePath || '').trim()
    const probe = body.probe as { kind?: string } | undefined
    const repositoryUrl = String(body.repositoryUrl || '').trim()
    const gitRef = String(body.gitRef || '').trim()
    return {
      ok: true,
      workspacePath: wsPath,
      workspaceName,
      probe,
      repositoryUrl: repositoryUrl || undefined,
      gitRef: gitRef || undefined,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function postGithubSync(repoUrl: string, ref: string, githubToken?: string): Promise<AnalysisOk | AnalysisFail> {
  const url = repoUrl.trim()
  lastResultJson.value = ''
  if (!url) {
    return { ok: false, error: 'Missing repository URL for sync.' }
  }
  try {
    const payload: Record<string, string> = { repositoryUrl: url, ref: ref.trim() }
    const tok = String(githubToken || '').trim()
    if (tok) {
      payload.gitToken = tok
      payload.githubToken = tok
    }
    const res = await fetch(`${base.value}/api/workspace/github/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || body.ok !== true) {
      return {
        ok: false,
        error: String(body.error || `Request failed (${res.status}).`),
        body,
      }
    }
    const workspaceName = String(body.workspaceName || '').trim() || 'workspace'
    const wsPath = String(body.workspacePath || '').trim()
    const probe = body.probe as { kind?: string } | undefined
    const canonical = String(body.repositoryUrl || '').trim()
    const gitRef = String(body.gitRef || '').trim()
    return {
      ok: true,
      workspacePath: wsPath,
      workspaceName,
      probe,
      repositoryUrl: canonical || undefined,
      gitRef: gitRef || undefined,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function postLocalAnalysis(workspacePath: string, courseId?: string): Promise<AnalysisOk | AnalysisFail> {
  const path = workspacePath.trim()
  lastResultJson.value = ''
  if (!path) {
    return { ok: false, error: 'Please enter an absolute repository path.' }
  }
  try {
    const payload: Record<string, string> = { workspacePath: path }
    const cid = String(courseId || '').trim()
    if (cid) payload.courseId = cid
    const res = await fetch(`${base.value}/api/analysis/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || body.ok !== true) {
      return {
        ok: false,
        error: String(body.error || `Request failed (${res.status}).`),
        body,
      }
    }
    const workspaceName = String(body.workspaceName || '').trim() || 'workspace'
    const wsPath = String(body.workspacePath || path).trim()
    const probe = body.probe as { kind?: string } | undefined
    return { ok: true, workspacePath: wsPath, workspaceName, probe }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function createCourseFromForm(): Promise<void> {
  courseSubmitError.value = ''
  const slug = newCourseSlug.value.trim()
  const title = newCourseTitle.value.trim()
  if (!slug || !title) {
    courseSubmitError.value = 'Course slug and title are required.'
    return
  }
  courseFormBusy.value = true
  try {
    const res = await fetch(`${base.value}/api/courses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, title, term: newCourseTerm.value.trim() }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; course?: { id: string } }
    if (!res.ok || body.ok !== true) {
      courseSubmitError.value = String(body.error || `Request failed (${res.status}).`)
      return
    }
    newCourseSlug.value = ''
    newCourseTitle.value = ''
    newCourseTerm.value = ''
    await fetchHome()
    if (body.course?.id) selectedCourseId.value = body.course.id
    closeCourseDialog()
  } catch (e) {
    courseSubmitError.value = e instanceof Error ? e.message : String(e)
  } finally {
    courseFormBusy.value = false
  }
}

async function removeCourse(course: RuntimeCourse): Promise<void> {
  courseSubmitError.value = ''
  if (
    !confirm(
      `Remove course «${course.title}»? Workspace folders are not deleted; only the course grouping on this runtime is removed.`,
    )
  ) {
    return
  }
  deletingCourseId.value = course.id
  try {
    const res = await fetch(`${base.value}/api/courses/${encodeURIComponent(course.id)}`, { method: 'DELETE' })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || body.ok !== true) {
      courseSubmitError.value = String(body.error || `Request failed (${res.status}).`)
      return
    }
    if (selectedCourseId.value === course.id) selectedCourseId.value = ''
    await fetchHome()
  } catch (e) {
    courseSubmitError.value = e instanceof Error ? e.message : String(e)
  } finally {
    deletingCourseId.value = ''
  }
}

async function addRepositoryFromForm(): Promise<void> {
  submitError.value = ''
  githubSubmitError.value = ''
  lastResultJson.value = ''
  const path = workspacePathInput.value.trim()
  if (!path) {
    submitError.value = 'Please enter an absolute repository path.'
    return
  }
  formBusy.value = true
  try {
    const cid = String(selectedCourseId.value || '').trim()
    const result = await postLocalAnalysis(path, cid || undefined)
    if (!result.ok) {
      submitError.value = result.error
      if (result.body) lastResultJson.value = JSON.stringify(result.body, null, 2)
      return
    }
    markAnalyzed(result.workspacePath)
    pushSessionRepo({
      workspacePath: result.workspacePath,
      workspaceName: result.workspaceName,
      probe: result.probe,
    })
    await fetchHome()
    submitError.value = ''
    workspacePathInput.value = ''
    closeLocalRepoDialog()
  } finally {
    formBusy.value = false
  }
}

async function addRepositoryFromGithub(): Promise<void> {
  githubSubmitError.value = ''
  submitError.value = ''
  lastResultJson.value = ''
  const repoUrl = githubUrlInput.value.trim()
  if (!repoUrl) {
    githubSubmitError.value = 'Please enter an HTTPS GitHub or GitLab repository URL.'
    return
  }
  githubFormBusy.value = true
  try {
    const cid = String(selectedCourseId.value || '').trim()
    const result = await postGithubAnalysis(repoUrl, githubRefInput.value, githubTokenInput.value, cid || undefined)
    if (!result.ok) {
      githubSubmitError.value = result.error
      if (result.body) lastResultJson.value = JSON.stringify(result.body, null, 2)
      return
    }
    markAnalyzed(result.workspacePath)
    pushSessionRepo({
      workspacePath: result.workspacePath,
      workspaceName: result.workspaceName,
      probe: result.probe,
      source: remoteSourceFromRepositoryUrl(result.repositoryUrl),
      repositoryUrl: result.repositoryUrl,
      gitRef: result.gitRef,
    })
    await fetchHome()
    githubSubmitError.value = ''
    githubUrlInput.value = ''
    githubRefInput.value = ''
    githubTokenInput.value = ''
    closeRemoteRepoDialog()
  } finally {
    githubFormBusy.value = false
  }
}

async function syncGithubRepo(repo: RuntimeHomeRepo): Promise<void> {
  cardError.value = ''
  githubSubmitError.value = ''
  lastResultJson.value = ''
  const repoUrl = repo.repositoryUrl?.trim()
  if (!repoUrl) {
    cardError.value =
      'This card has no clone URL stored; remove it and add the repository again using “Add from GitHub or GitLab”.'
    return
  }
  syncingGithubPath.value = repo.workspacePath
  try {
    const tok = githubTokenInput.value.trim()
    const result = await postGithubSync(repoUrl, repo.gitRef ?? '', tok || undefined)
    if (!result.ok) {
      cardError.value = result.error
      if (result.body) lastResultJson.value = JSON.stringify(result.body, null, 2)
      return
    }
    markAnalyzed(result.workspacePath)
    await fetchHome()
  } finally {
    syncingGithubPath.value = ''
  }
}

function findRepoForPath(workspacePath: string): RuntimeHomeRepo | undefined {
  const orphan = repositoryCards.value.find((r) => r.workspacePath === workspacePath)
  if (orphan) return orphan
  for (const c of homeModel.value?.courses ?? []) {
    const w = c.workspaces?.find((r) => r.workspacePath === workspacePath)
    if (w) return w
  }
  return undefined
}

async function ensureAnalyzedForOpen(workspacePath: string): Promise<AnalysisOk | null> {
  if (wasOpenedOrAnalyzed(workspacePath)) {
    const card = findRepoForPath(workspacePath)
    return {
      ok: true,
      workspacePath,
      workspaceName: card?.workspaceName ?? 'workspace',
      probe: card?.probe,
    }
  }
  analyzingPath.value = workspacePath
  try {
    const result = await postLocalAnalysis(workspacePath)
    if (!result.ok) {
      cardError.value = result.error
      if (result.body) lastResultJson.value = JSON.stringify(result.body, null, 2)
      return null
    }
    markAnalyzed(result.workspacePath)
    await fetchHome()
    return result
  } finally {
    analyzingPath.value = ''
  }
}

async function openSbtDiagram(repo: RuntimeHomeRepo): Promise<void> {
  cardError.value = ''
  lastResultJson.value = ''
  const r = await ensureAnalyzedForOpen(repo.workspacePath)
  if (!r) return
  emit('openSbt', { workspacePath: r.workspacePath, workspaceName: r.workspaceName })
}

async function openPackageDiagram(repo: RuntimeHomeRepo): Promise<void> {
  cardError.value = ''
  lastResultJson.value = ''
  const r = await ensureAnalyzedForOpen(repo.workspacePath)
  if (!r) return
  emit('openPackages', { workspacePath: r.workspacePath, workspaceName: r.workspaceName })
}

function formatLastOpened(value?: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function repoKind(repo: RuntimeHomeRepo): string {
  return repo.probe?.kind || 'workspace'
}

function repoCardIconUrl(repo: RuntimeHomeRepo): string {
  if (repo.source === 'github') return githubMarkIconUrl
  if (repo.source === 'gitlab') return gitlabMarkIconUrl
  return stackedCubesIconUrl
}

/** Infer persisted source for the session card before `/api/home` returns stored metadata. */
function remoteSourceFromRepositoryUrl(url: string | undefined): 'github' | 'gitlab' {
  const u = String(url || '').trim()
  if (!u) return 'gitlab'
  try {
    return new URL(u).hostname.toLowerCase() === 'github.com' ? 'github' : 'gitlab'
  } catch {
    return 'gitlab'
  }
}

function remoteRepoSupportsSync(repo: RuntimeHomeRepo): boolean {
  return (
    (repo.source === 'github' || repo.source === 'gitlab') &&
    !!repo.repositoryUrl?.trim() &&
    runtimeSupportsGithubSync.value
  )
}

onMounted(() => {
  void fetchHome()
})

watch(
  () => props.runtimeBaseUrl,
  () => {
    void fetchHome()
  },
)
</script>

<template>
  <div class="runtime-home">
    <div class="runtime-home__inner">
      <div v-if="showContextBar" class="runtime-home__context-bar">
        <div class="runtime-home__context-row">
          <div v-if="ideSession" class="runtime-home__ide-chip" :title="ideSession.ideOpenUrl">
            <div class="runtime-home__ide-chip-main">
              <span class="runtime-home__ide-chip-label">Connected to {{ ideSession.ideName }}</span>
              <span v-if="ideSession.workspaceName" class="runtime-home__ide-chip-meta">{{ ideSession.workspaceName }}</span>
            </div>
            <div v-if="ideSession.activeFile" class="runtime-home__ide-chip-file">{{ ideSession.activeFile }}</div>
          </div>
          <div v-if="runtimeWorkspaceActive" class="runtime-home__ctx-actions">
            <button
              type="button"
              class="runtime-home__ctx-btn"
              :disabled="!!runtimeActionBusy"
              @click="onRuntimeWorkspaceAction('refresh', 'Refreshing workspace')"
            >
              {{ runtimeActionBusy === 'refresh' ? 'Refreshing…' : 'Refresh workspace' }}
            </button>
            <button
              type="button"
              class="runtime-home__ctx-btn"
              :disabled="!!runtimeActionBusy"
              @click="onRuntimeWorkspaceAction('sbt-test', 'Running sbt test')"
            >
              {{ runtimeActionBusy === 'sbt-test' ? 'Running tests…' : 'Run sbt test' }}
            </button>
            <button
              type="button"
              class="runtime-home__ctx-btn"
              :disabled="!!runtimeActionBusy"
              @click="onRuntimeWorkspaceAction('sbt-coverage', 'Running coverage')"
            >
              {{ runtimeActionBusy === 'sbt-coverage' ? 'Running coverage…' : 'Run coverage' }}
            </button>
          </div>
        </div>
        <p v-if="trimmedStatus" class="runtime-home__status-line">{{ trimmedStatus }}</p>
      </div>

      <header class="runtime-home__hero">
        <h1>Triton Architecture Explorer</h1>
        <p>
          Use <strong>Add local repo</strong> (folder), <strong>Add new repo</strong> (GitHub / GitLab), and
          <strong>Add Course</strong> (below once the runtime is connected) to register
          workspaces. Optionally create <strong>Courses</strong> to group repos on the server. Open the SBT or package
          diagram from each card. Bundled examples and dojos open in new tabs.
        </p>
      </header>

      <section v-if="loadError" class="runtime-home__card runtime-home__card--error" role="alert">
        {{ loadError }}
        <p class="runtime-home__hint">Check that triton-runtime is reachable at {{ base }}.</p>
      </section>

      <section v-if="homeModel?.runtime" class="runtime-home__meta runtime-home__meta--compact">
        <div>
          <strong>Runtime</strong>
          <div class="runtime-home__mono">{{ homeModel.runtime.publicRuntimeUrl || base }}</div>
        </div>
        <div v-if="homeModel.runtime.allowedRepoRoots?.length">
          <strong>Allowed roots</strong>
          <ul class="runtime-home__roots">
            <li v-for="(r, i) in homeModel.runtime.allowedRepoRoots" :key="i">
              <code>{{ r }}</code>
            </li>
          </ul>
        </div>
        <div v-if="homeModel.runtime.gitCacheRoot">
          <strong>Remote Git clone cache</strong>
          <div class="runtime-home__mono">{{ homeModel.runtime.gitCacheRoot }}</div>
        </div>
        <div v-if="homeModel.runtime.version">
          <strong>Runtime version</strong>
          <div class="runtime-home__mono">{{ homeModel.runtime.version }}</div>
        </div>
        <div v-if="homeModel.runtime.persistenceBackend">
          <strong>Persistence</strong>
          <div class="runtime-home__mono">{{ homeModel.runtime.persistenceBackend }}</div>
        </div>
      </section>

      <section
        v-if="githubRuntimeStaleWarning"
        class="runtime-home__card runtime-home__card--warn"
        role="status"
      >
        <strong>Hosted Git clone unavailable on this runtime</strong>
        <p class="runtime-home__hint">
          <code>/api/home</code> does not list <code>analysis-github</code> in <code>capabilities</code>, so this process
          is an older triton-runtime (or not rebuilt). Restart from the branch that adds
          <code>POST /api/analysis/github</code> (GitHub and GitLab HTTPS URLs), or run
          <code>curl -sS -X POST {{ base }}/api/analysis/github -H 'content-type: application/json' -d '{}'</code>
          — you want HTTP <strong>400</strong>
          <code>missing_repository_url</code>, not <strong>404</strong>
          <code>not_found</code>.
        </p>
      </section>

      <section v-if="homeModel?.runtime" class="runtime-home__card runtime-home__card--actions">
        <h2 class="runtime-home__actions-title">Repositories</h2>
        <p class="runtime-home__add-lead runtime-home__actions-lead">
          Open a dialog to register a workspace (local or hosted Git) or add a course.
        </p>
        <div class="runtime-home__action-bar">
          <button
            type="button"
            class="runtime-home__btn runtime-home__btn--primary runtime-home__btn--repo-hosts"
            aria-label="Add local repo from folder"
            @click="openLocalRepoDialog"
          >
            <span>Add local repo</span>
            <span class="runtime-home__repo-host-icons" aria-hidden="true">
              <img class="runtime-home__repo-host-icon" :src="folderIconUrl" alt="" width="20" height="20" />
            </span>
          </button>
          <button
            type="button"
            class="runtime-home__btn runtime-home__btn--primary runtime-home__btn--repo-hosts"
            aria-label="Add new repo from GitHub or GitLab"
            :disabled="githubRuntimeStaleWarning"
            @click="openRemoteRepoDialog"
          >
            <span>Add new repo</span>
            <span class="runtime-home__repo-host-icons" aria-hidden="true">
              <img class="runtime-home__repo-host-icon" :src="githubMarkIconUrl" alt="" width="20" height="20" />
              <img class="runtime-home__repo-host-icon" :src="gitlabMarkIconUrl" alt="" width="20" height="20" />
            </span>
          </button>
          <button
            v-if="showCoursesSection"
            type="button"
            class="runtime-home__btn runtime-home__btn--primary"
            @click="openCourseDialog"
          >
            Add Course
          </button>
          <button type="button" class="runtime-home__btn" @click="void fetchHome()">Refresh lists</button>
        </div>
      </section>

      <section v-if="showCoursesSection" class="runtime-home__card">
        <div
          v-if="!runtimeSupportsCourses"
          class="runtime-home__courses-compat"
          role="status"
        >
          <strong>Course storage needs a newer runtime</strong>
          <p class="runtime-home__hint">
            <code>GET {{ base }}/health</code> should list <code>courses-api</code> in <code>capabilities</code> and version
            <strong>0.5.0</strong> or newer. Restart or rebuild <code>triton-runtime</code> from this repo, then refresh this page.
          </p>
        </div>
        <div class="runtime-home__courses-body" :class="{ 'runtime-home__courses-body--disabled': !runtimeSupportsCourses }">
        <div class="runtime-home__add-head">
          <img class="runtime-home__add-icon" :src="stackedCubesIconUrl" width="32" height="32" alt="" />
          <div>
            <h2>Courses</h2>
            <p class="runtime-home__add-lead">
              Group hosted Git (GitHub/GitLab) or local workspaces for a class or project. Use <strong>Add Course</strong>
              in the bar above. Repositories in a course stay in recent history but are listed here; ungrouped recents appear
              under “Other workspaces”.
            </p>
          </div>
        </div>
        <p v-if="courseSubmitError && !courseDialogOpen" class="runtime-home__error">{{ courseSubmitError }}</p>
        <p v-if="runtimeSupportsCourses && !(homeModel?.courses?.length)" class="runtime-home__hint">
          No courses yet. Use <strong>Add Course</strong> above, then optionally pick a course when adding a repo.
        </p>
        <details
          v-for="course in homeModel?.courses ?? []"
          :key="course.id"
          class="runtime-home__fold runtime-home__fold--course"
        >
          <summary class="runtime-home__fold-summary runtime-home__course-summary">
            <span class="runtime-home__course-summary-main">
              <span class="runtime-home__fold-title">{{ course.title }}</span>
              <span v-if="course.term" class="runtime-home__course-term">{{ course.term }}</span>
              <span class="runtime-home__fold-count">{{ course.workspaces?.length ?? 0 }}</span>
            </span>
            <button
              type="button"
              class="runtime-home__course-del"
              :disabled="!runtimeSupportsCourses || !!deletingCourseId || courseFormBusy"
              @click.prevent.stop="void removeCourse(course)"
            >
              {{ deletingCourseId === course.id ? 'Removing…' : 'Remove' }}
            </button>
          </summary>
          <div class="runtime-home__fold-body">
            <p v-if="!(course.workspaces?.length)" class="runtime-home__fold-hint">No workspaces linked yet.</p>
            <div v-else class="runtime-home__grid">
              <article v-for="repo in course.workspaces" :key="repo.workspacePath" class="repo-card">
                <div class="repo-card__icon-wrap" aria-hidden="true">
                  <img class="repo-card__icon" :src="repoCardIconUrl(repo)" width="28" height="28" alt="" />
                </div>
                <div class="repo-card__body">
                  <div class="repo-card__title-row">
                    <h3 class="repo-card__title">{{ repo.workspaceName }}</h3>
                    <span v-if="repo.source === 'github'" class="repo-card__pill repo-card__pill--github">GitHub</span>
                    <span v-if="repo.source === 'gitlab'" class="repo-card__pill repo-card__pill--gitlab">GitLab</span>
                  </div>
                  <p class="repo-card__path"><code>{{ repo.workspacePath }}</code></p>
                  <p class="repo-card__meta">
                    <span class="repo-card__badge">{{ repoKind(repo) }}</span>
                    <template v-if="repo.lastOpenedAt">
                      <span class="repo-card__dot" aria-hidden="true">·</span>
                      <span class="runtime-home__muted">Linked {{ formatLastOpened(repo.lastOpenedAt) }}</span>
                    </template>
                  </p>
                  <div class="repo-card__links">
                    <button
                      type="button"
                      class="repo-card__link"
                      :disabled="!!analyzingPath || !!syncingGithubPath"
                      @click="void openSbtDiagram(repo)"
                    >
                      SBT diagram
                    </button>
                    <span class="repo-card__sep" aria-hidden="true">·</span>
                    <button
                      type="button"
                      class="repo-card__link"
                      :disabled="!!analyzingPath || !!syncingGithubPath"
                      @click="void openPackageDiagram(repo)"
                    >
                      Package diagram
                    </button>
                    <template v-if="remoteRepoSupportsSync(repo)">
                      <span class="repo-card__sep" aria-hidden="true">·</span>
                      <button
                        type="button"
                        class="repo-card__link"
                        :disabled="!!analyzingPath || !!syncingGithubPath"
                        @click="void syncGithubRepo(repo)"
                      >
                        {{ syncingGithubPath === repo.workspacePath ? 'Syncing…' : 'Pull latest' }}
                      </button>
                    </template>
                    <span v-if="analyzingPath === repo.workspacePath" class="repo-card__busy" aria-live="polite">
                      Preparing…
                    </span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </details>
        </div>
      </section>

      <dialog
        ref="courseDialogRef"
        class="runtime-home__dialog"
        aria-labelledby="runtime-dialog-course-title"
        @close="courseDialogOpen = false"
      >
        <div class="runtime-home__dialog-panel">
          <header class="runtime-home__dialog-head">
            <h2 id="runtime-dialog-course-title">Add Course</h2>
            <button type="button" class="runtime-home__dialog-close" aria-label="Close" @click="closeCourseDialog">
              ×
            </button>
          </header>
          <div
            v-if="!runtimeSupportsCourses"
            class="runtime-home__courses-compat runtime-home__dialog-compat"
            role="status"
          >
            <strong>Course storage needs a newer runtime</strong>
            <p class="runtime-home__hint">
              Upgrade <code>triton-runtime</code> so <code>/health</code> lists <code>courses-api</code> (version 0.5.0+).
            </p>
          </div>
          <form class="runtime-home__form" @submit.prevent="void createCourseFromForm()">
            <label class="runtime-home__label" for="runtime-dialog-course-slug">Course slug (URL-safe)</label>
            <input
              id="runtime-dialog-course-slug"
              v-model="newCourseSlug"
              class="runtime-home__input"
              type="text"
              autocomplete="off"
              placeholder="e.g. cs-101-fall"
              :disabled="!runtimeSupportsCourses"
            />
            <label class="runtime-home__label" for="runtime-dialog-course-title-field">Title</label>
            <input
              id="runtime-dialog-course-title-field"
              v-model="newCourseTitle"
              class="runtime-home__input"
              type="text"
              autocomplete="off"
              placeholder="Introduction to Software Architecture"
              :disabled="!runtimeSupportsCourses"
            />
            <label class="runtime-home__label" for="runtime-dialog-course-term">Term (optional)</label>
            <input
              id="runtime-dialog-course-term"
              v-model="newCourseTerm"
              class="runtime-home__input"
              type="text"
              autocomplete="off"
              placeholder="Fall 2026"
              :disabled="!runtimeSupportsCourses"
            />
            <p v-if="courseSubmitError" class="runtime-home__error">{{ courseSubmitError }}</p>
            <div class="runtime-home__dialog-actions">
              <button type="button" class="runtime-home__btn" :disabled="courseFormBusy" @click="closeCourseDialog">
                Cancel
              </button>
              <button
                type="submit"
                class="runtime-home__btn runtime-home__btn--primary"
                :disabled="!runtimeSupportsCourses || courseFormBusy || !!deletingCourseId"
              >
                {{ courseFormBusy ? 'Creating…' : 'Create course' }}
              </button>
            </div>
          </form>
        </div>
      </dialog>

      <dialog ref="localRepoDialogRef" class="runtime-home__dialog" aria-labelledby="runtime-dialog-local-title">
        <div class="runtime-home__dialog-panel">
          <header class="runtime-home__dialog-head">
            <h2 id="runtime-dialog-local-title">Add local repo from folder</h2>
            <button type="button" class="runtime-home__dialog-close" aria-label="Close" @click="closeLocalRepoDialog">
              ×
            </button>
          </header>
          <p class="runtime-home__dialog-lead">
            Registers an absolute path with the runtime and adds a card to the list. Open diagrams from the card when ready.
          </p>
          <form class="runtime-home__form" @submit.prevent="void addRepositoryFromForm()">
            <label class="runtime-home__label" for="runtime-dialog-local-path">Repository path</label>
            <input
              id="runtime-dialog-local-path"
              v-model="workspacePathInput"
              class="runtime-home__input"
              type="text"
              autocomplete="off"
              placeholder="/repos/my-project"
            />
            <template v-if="hasCoursesForPicker">
              <label class="runtime-home__label" for="runtime-dialog-local-course">Course (optional)</label>
              <select
                id="runtime-dialog-local-course"
                v-model="selectedCourseId"
                class="runtime-home__input runtime-home__select"
              >
                <option value="">— None —</option>
                <option v-for="c in homeModel?.courses ?? []" :key="c.id" :value="c.id">{{ c.title }}</option>
              </select>
            </template>
            <p v-if="submitError" class="runtime-home__error">{{ submitError }}</p>
            <details v-if="lastResultJson && submitError" class="runtime-home__details">
              <summary>Response details</summary>
              <pre class="runtime-home__pre">{{ lastResultJson }}</pre>
            </details>
            <div class="runtime-home__dialog-actions">
              <button type="button" class="runtime-home__btn" :disabled="formBusy" @click="closeLocalRepoDialog">
                Cancel
              </button>
              <button type="submit" class="runtime-home__btn runtime-home__btn--primary" :disabled="formBusy">
                {{ formBusy ? 'Adding…' : 'Add repository' }}
              </button>
            </div>
          </form>
        </div>
      </dialog>

      <dialog ref="remoteRepoDialogRef" class="runtime-home__dialog" aria-labelledby="runtime-dialog-remote-title">
        <div class="runtime-home__dialog-panel">
          <header class="runtime-home__dialog-head">
            <h2 id="runtime-dialog-remote-title">Add new repo from GitHub / GitLab</h2>
            <button type="button" class="runtime-home__dialog-close" aria-label="Close" @click="closeRemoteRepoDialog">
              ×
            </button>
          </header>
          <p class="runtime-home__dialog-lead">
            Clones an HTTPS repository into the runtime cache. Re-adding the same URL refreshes the clone. Self-hosted GitLab:
            set <code>TRITON_EXTRA_GIT_HOSTS</code> on the runtime.
          </p>
          <form class="runtime-home__form" @submit.prevent="void addRepositoryFromGithub()">
            <label class="runtime-home__label" for="runtime-dialog-remote-url">Repository URL (HTTPS)</label>
            <input
              id="runtime-dialog-remote-url"
              v-model="githubUrlInput"
              class="runtime-home__input"
              type="url"
              autocomplete="off"
              placeholder="https://github.com/scala/hello-world.g8 or https://gitlab.com/gitlab-org/gitlab"
            />
            <label class="runtime-home__label" for="runtime-dialog-remote-ref">Branch or tag (optional)</label>
            <input
              id="runtime-dialog-remote-ref"
              v-model="githubRefInput"
              class="runtime-home__input"
              type="text"
              autocomplete="off"
              placeholder="main"
            />
            <label class="runtime-home__label" for="runtime-dialog-remote-token">Access token (optional)</label>
            <input
              id="runtime-dialog-remote-token"
              v-model="githubTokenInput"
              class="runtime-home__input"
              type="password"
              autocomplete="new-password"
              placeholder="GitHub PAT or GitLab PAT — cleared after add"
            />
            <p class="runtime-home__hint runtime-home__hint--field">
              Sent only with this request; not stored on the card.
            </p>
            <template v-if="hasCoursesForPicker">
              <label class="runtime-home__label" for="runtime-dialog-remote-course">Course (optional)</label>
              <select
                id="runtime-dialog-remote-course"
                v-model="selectedCourseId"
                class="runtime-home__input runtime-home__select"
              >
                <option value="">— None —</option>
                <option v-for="c in homeModel?.courses ?? []" :key="c.id" :value="c.id">{{ c.title }}</option>
              </select>
            </template>
            <p v-if="githubSubmitError" class="runtime-home__error">{{ githubSubmitError }}</p>
            <details v-if="lastResultJson && githubSubmitError" class="runtime-home__details">
              <summary>Response details</summary>
              <pre class="runtime-home__pre">{{ lastResultJson }}</pre>
            </details>
            <div class="runtime-home__dialog-actions">
              <button type="button" class="runtime-home__btn" :disabled="githubFormBusy" @click="closeRemoteRepoDialog">
                Cancel
              </button>
              <button
                type="submit"
                class="runtime-home__btn runtime-home__btn--primary"
                :disabled="githubFormBusy || githubRuntimeStaleWarning"
              >
                {{ githubFormBusy ? 'Cloning…' : 'Clone & add' }}
              </button>
            </div>
          </form>
        </div>
      </dialog>

      <section class="runtime-home__deck">
        <div class="runtime-home__deck-head">
          <h2>{{ orphanDeckTitle }}</h2>
          <span class="runtime-home__muted">{{ repositoryCards.length }} workspace{{ repositoryCards.length === 1 ? '' : 's' }}</span>
        </div>
        <p v-if="cardError" class="runtime-home__error runtime-home__error--card">{{ cardError }}</p>
        <details v-if="lastResultJson && cardError && !submitError" class="runtime-home__details">
          <summary>Response details</summary>
          <pre class="runtime-home__pre">{{ lastResultJson }}</pre>
        </details>
        <div v-if="!repositoryCards.length" class="runtime-home__empty runtime-home__empty--deck">
          <template v-if="assignedWorkspacePaths.size > 0">
            No ungrouped workspaces. Repositories assigned to a course appear under Courses above.
          </template>
          <template v-else>
            No repositories yet. Add a path above, or use Refresh after opening workspaces from other clients.
          </template>
        </div>
        <div v-else class="runtime-home__grid">
          <article v-for="repo in repositoryCards" :key="repo.workspacePath" class="repo-card">
            <div class="repo-card__icon-wrap" aria-hidden="true">
              <img class="repo-card__icon" :src="repoCardIconUrl(repo)" width="28" height="28" alt="" />
            </div>
            <div class="repo-card__body">
              <div class="repo-card__title-row">
                <h3 class="repo-card__title">{{ repo.workspaceName }}</h3>
                <span v-if="repo.source === 'github'" class="repo-card__pill repo-card__pill--github">GitHub</span>
                <span v-if="repo.source === 'gitlab'" class="repo-card__pill repo-card__pill--gitlab">GitLab</span>
                <span v-if="isSessionListed(repo)" class="repo-card__pill">Added</span>
              </div>
              <p class="repo-card__path"><code>{{ repo.workspacePath }}</code></p>
              <p class="repo-card__meta">
                <span class="repo-card__badge">{{ repoKind(repo) }}</span>
                <template v-if="repo.lastOpenedAt">
                  <span class="repo-card__dot" aria-hidden="true">·</span>
                  <span class="runtime-home__muted">Last opened {{ formatLastOpened(repo.lastOpenedAt) }}</span>
                </template>
              </p>
              <div class="repo-card__links">
                <button
                  type="button"
                  class="repo-card__link"
                  :disabled="!!analyzingPath || !!syncingGithubPath"
                  @click="void openSbtDiagram(repo)"
                >
                  SBT diagram
                </button>
                <span class="repo-card__sep" aria-hidden="true">·</span>
                <button
                  type="button"
                  class="repo-card__link"
                  :disabled="!!analyzingPath || !!syncingGithubPath"
                  @click="void openPackageDiagram(repo)"
                >
                  Package diagram
                </button>
                <template v-if="remoteRepoSupportsSync(repo)">
                  <span class="repo-card__sep" aria-hidden="true">·</span>
                  <button
                    type="button"
                    class="repo-card__link"
                    :disabled="!!analyzingPath || !!syncingGithubPath"
                    @click="void syncGithubRepo(repo)"
                  >
                    {{ syncingGithubPath === repo.workspacePath ? 'Syncing…' : 'Pull latest' }}
                  </button>
                </template>
                <span v-if="analyzingPath === repo.workspacePath" class="repo-card__busy" aria-live="polite">
                  Preparing…
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section v-if="starterCardTotal > 0" class="runtime-home__deck runtime-home__deck--starters">
        <div class="runtime-home__deck-head">
          <h2>Bundled examples</h2>
          <span class="runtime-home__muted">{{ starterCardTotal }} diagrams</span>
        </div>
        <p class="runtime-home__starters-lead">
          Expand a section to browse cards. Each card still shows its type (YAML, Dojo, SBT, TypeScript).
        </p>
        <details
          v-for="sec in starterFoldSections"
          :key="sec.id"
          class="runtime-home__fold"
        >
          <summary class="runtime-home__fold-summary">
            <span class="runtime-home__fold-title">{{ sec.title }}</span>
            <span class="runtime-home__fold-count">{{ sec.cards.length }}</span>
          </summary>
          <div class="runtime-home__fold-body">
            <p class="runtime-home__fold-hint">{{ sec.hint }}</p>
            <div class="runtime-home__grid runtime-home__grid--starters">
              <article
                v-for="card in sec.cards"
                :key="card.selectionId"
                class="starter-card"
                :class="`starter-card--${card.kind}`"
              >
                <div class="starter-card__icon-wrap" aria-hidden="true">
                  <img class="starter-card__icon" :src="starterIconUrl(card)" width="28" height="28" alt="" />
                </div>
                <div class="starter-card__body">
                  <div class="starter-card__title-row">
                    <span class="starter-kind" :class="`starter-kind--${card.kind}`">{{ starterKindLabel(card.kind) }}</span>
                    <span v-if="card.group" class="starter-card__group">{{ card.group }}</span>
                  </div>
                  <h3 class="starter-card__title">{{ card.title }}</h3>
                  <p v-if="card.subtitle" class="starter-card__subtitle">{{ card.subtitle }}</p>
                  <button type="button" class="starter-card__open" @click="openStarter(card)">Open</button>
                </div>
              </article>
            </div>
          </div>
        </details>
      </section>
    </div>
  </div>
</template>

<style scoped>
.runtime-home {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: linear-gradient(180deg, #f0f9ff 0%, #f8fafc 45%, #ecfeff 100%);
  color: #0f172a;
}
.runtime-home__inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 20px 40px;
  display: grid;
  gap: 22px;
}
.runtime-home__context-bar {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.04);
}
.runtime-home__context-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.runtime-home__ide-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: min(100%, 520px);
  padding: 8px 12px;
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  line-height: 1.25;
}
.runtime-home__ide-chip-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.runtime-home__ide-chip-file {
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: #475569;
  word-break: break-all;
  max-width: 100%;
}
.runtime-home__ide-chip-label {
  font-weight: 700;
}
.runtime-home__ide-chip-meta {
  color: #475569;
  font-weight: 500;
}
.runtime-home__ctx-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.runtime-home__ctx-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  cursor: pointer;
  font-family: inherit;
}
.runtime-home__ctx-btn:hover:not(:disabled) {
  background: #f1f5f9;
}
.runtime-home__ctx-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}
.runtime-home__status-line {
  margin: 10px 0 0;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
  font-size: 13px;
  line-height: 1.45;
  color: #475569;
  word-break: break-word;
}
.runtime-home__hero h1 {
  margin: 0 0 8px;
  font-size: 28px;
  letter-spacing: -0.02em;
}
.runtime-home__hero p {
  margin: 0;
  line-height: 1.55;
  max-width: 72ch;
  color: #334155;
}
.runtime-home__card {
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 20px 22px;
  box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
}
.runtime-home__card--actions {
  border-color: #bae6fd;
  box-shadow: 0 8px 28px rgba(14, 116, 144, 0.08);
}
.runtime-home__actions-title {
  margin: 0 0 4px;
  font-size: 18px;
}
.runtime-home__actions-lead {
  margin: 0 0 14px;
}
.runtime-home__action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.runtime-home__btn--repo-hosts {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.runtime-home__repo-host-icons {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.runtime-home__repo-host-icon {
  display: block;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  object-fit: contain;
}
.runtime-home__dialog {
  border: none;
  border-radius: 16px;
  padding: 0;
  max-width: min(520px, calc(100vw - 32px));
  width: 100%;
  background: #fff;
  color: #0f172a;
  box-shadow: 0 25px 60px rgba(15, 23, 42, 0.28);
}
.runtime-home__dialog::backdrop {
  background: rgba(15, 23, 42, 0.48);
}
.runtime-home__dialog-panel {
  padding: 22px 24px 24px;
}
.runtime-home__dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.runtime-home__dialog-head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.runtime-home__dialog-close {
  flex-shrink: 0;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  color: #475569;
  font-family: inherit;
  padding: 0;
}
.runtime-home__dialog-close:hover {
  background: #f1f5f9;
  color: #0f172a;
}
.runtime-home__dialog-lead {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.45;
  color: #475569;
}
.runtime-home__dialog-lead code {
  font-size: 12px;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 6px;
}
.runtime-home__dialog-compat {
  margin-bottom: 14px;
}
.runtime-home__dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
.runtime-home__card h2 {
  margin: 0;
  font-size: 18px;
}
.runtime-home__card--error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}
.runtime-home__card--warn {
  border-color: #fcd34d;
  background: #fffbeb;
  color: #92400e;
}
.runtime-home__card--warn .runtime-home__hint {
  color: #78350f;
}
.runtime-home__meta--compact {
  display: flex;
  flex-wrap: wrap;
  gap: 20px 28px;
  font-size: 13px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.runtime-home__mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  margin-top: 4px;
  word-break: break-all;
  color: #475569;
}
.runtime-home__roots {
  margin: 6px 0 0;
  padding-left: 18px;
}
.runtime-home__add-head {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}
.runtime-home__add-icon {
  flex-shrink: 0;
  margin-top: 2px;
  opacity: 0.92;
}
.runtime-home__add-lead {
  margin: 6px 0 0;
  font-size: 14px;
  color: #475569;
  line-height: 1.45;
}
.runtime-home__form {
  display: grid;
  gap: 10px;
}
.runtime-home__label {
  font-weight: 600;
  font-size: 14px;
}
.runtime-home__input {
  width: 100%;
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid #94a3b8;
  font: inherit;
  box-sizing: border-box;
  background: #fff;
}
.runtime-home__input:focus {
  outline: 2px solid #38bdf8;
  outline-offset: 1px;
  border-color: #0ea5e9;
}
.runtime-home__select {
  cursor: pointer;
}
.runtime-home__courses-compat {
  margin: -4px 0 18px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #fcd34d;
  background: #fffbeb;
  color: #92400e;
}
.runtime-home__courses-compat strong {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
}
.runtime-home__courses-compat .runtime-home__hint {
  margin-top: 0;
  color: #78350f;
}
.runtime-home__courses-body--disabled {
  opacity: 0.55;
  pointer-events: none;
}
.runtime-home__fold--course {
  margin-top: 12px;
}
.runtime-home__course-summary {
  align-items: center;
}
.runtime-home__course-summary-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
.runtime-home__course-term {
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
}
.runtime-home__course-del {
  flex-shrink: 0;
  margin-left: auto;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #991b1b;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.runtime-home__course-del:hover:not(:disabled) {
  background: #fee2e2;
}
.runtime-home__course-del:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.runtime-home__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 4px;
}
.runtime-home__btn {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #f1f5f9;
  color: #0f172a;
  font: inherit;
  cursor: pointer;
}
.runtime-home__btn:hover {
  background: #e2e8f0;
}
.runtime-home__btn--primary {
  border: 0;
  background: #0d9488;
  color: #fff;
  font-weight: 600;
}
.runtime-home__btn--primary:hover {
  background: #0f766e;
}
.runtime-home__btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.runtime-home__error {
  margin: 12px 0 0;
  color: #b91c1c;
  font-weight: 600;
  font-size: 14px;
}
.runtime-home__error--card {
  margin: 0 0 8px;
}
.runtime-home__hint {
  margin: 12px 0 0;
  font-size: 13px;
  color: #475569;
  line-height: 1.5;
}
.runtime-home__hint--field {
  margin: -4px 0 8px;
  font-size: 12px;
}
.runtime-home__muted {
  color: #64748b;
  font-size: 13px;
}
.runtime-home__deck-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.runtime-home__deck-head h2 {
  margin: 0;
  font-size: 17px;
}
.runtime-home__empty--deck {
  color: #64748b;
  font-size: 14px;
  line-height: 1.5;
  padding: 8px 0;
}
.runtime-home__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.repo-card {
  display: flex;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.04);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.repo-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.07);
}
.repo-card__icon-wrap {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(145deg, #ecfeff 0%, #e0f2fe 100%);
  border: 1px solid #bae6fd;
  display: flex;
  align-items: center;
  justify-content: center;
}
.repo-card__icon {
  display: block;
  opacity: 0.9;
}
.repo-card__body {
  min-width: 0;
  flex: 1;
}
.repo-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.repo-card__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.repo-card__pill {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 8px;
  border-radius: 999px;
  background: #ccfbf1;
  color: #0f766e;
}
.repo-card__pill--github {
  background: #dbeafe;
  color: #1d4ed8;
}
.repo-card__pill--gitlab {
  background: #fde8d0;
  color: #c26700;
}
.repo-card__path {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
  color: #475569;
}
.repo-card__path code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  background: #f1f5f9;
  padding: 2px 5px;
  border-radius: 4px;
}
.repo-card__meta {
  margin: 8px 0 0;
  font-size: 13px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.repo-card__dot {
  color: #94a3b8;
}
.repo-card__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e0f2fe;
  color: #0369a1;
  font-size: 11px;
  font-weight: 700;
}
.repo-card__links {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 4px;
}
.repo-card__link {
  padding: 0;
  margin: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: #0d9488;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgba(13, 148, 136, 0.35);
}
.repo-card__link:hover {
  color: #0f766e;
  text-decoration-color: #0f766e;
}
.repo-card__link:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.repo-card__sep {
  color: #cbd5e1;
  user-select: none;
}
.repo-card__busy {
  margin-left: 6px;
  font-size: 12px;
  color: #64748b;
}
.runtime-home__details {
  margin-top: 12px;
  font-size: 13px;
}
.runtime-home__pre {
  margin: 8px 0 0;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
}
.runtime-home__deck--starters .runtime-home__deck-head {
  margin-bottom: 6px;
}
.runtime-home__starters-lead {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.5;
  color: #475569;
}
.runtime-home__fold {
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.96);
  overflow: hidden;
  margin-bottom: 10px;
}
.runtime-home__fold:last-of-type {
  margin-bottom: 0;
}
.runtime-home__fold-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  list-style: none;
  user-select: none;
}
.runtime-home__fold-summary::-webkit-details-marker {
  display: none;
}
.runtime-home__fold-summary::marker {
  content: '';
}
.runtime-home__fold-title {
  letter-spacing: -0.01em;
}
.runtime-home__fold-count {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  background: #f1f5f9;
  padding: 4px 10px;
  border-radius: 999px;
}
.runtime-home__fold-body {
  padding: 0 14px 16px;
  border-top: 1px solid #f1f5f9;
}
.runtime-home__fold-hint {
  margin: 12px 0 14px;
  font-size: 13px;
  color: #64748b;
  line-height: 1.45;
}
.starter-kind {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.starter-kind--yaml {
  background: #e0f2fe;
  color: #0369a1;
}
.starter-kind--dojo {
  background: #ede9fe;
  color: #5b21b6;
}
.starter-kind--sbt {
  background: #ccfbf1;
  color: #0f766e;
}
.starter-kind--ts {
  background: #dbeafe;
  color: #1d4ed8;
}
.starter-kind--docker {
  background: #e0f2fe;
  color: #0369a1;
}
.runtime-home__grid--starters {
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}
.starter-card {
  display: flex;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.04);
  border-left: 4px solid #cbd5e1;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.starter-card:hover {
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.07);
}
.starter-card--yaml {
  border-left-color: #0284c7;
}
.starter-card--dojo {
  border-left-color: #7c3aed;
}
.starter-card--sbt {
  border-left-color: #0d9488;
}
.starter-card--ts {
  border-left-color: #2563eb;
}
.starter-card--docker {
  border-left-color: #2496ed;
}
.starter-card__icon-wrap {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.starter-card__icon {
  display: block;
  opacity: 0.92;
}
.starter-card__body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.starter-card__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.starter-card__group {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
}
.starter-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
.starter-card__subtitle {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: #64748b;
  word-break: break-word;
}
.starter-card__open {
  align-self: flex-start;
  margin-top: 8px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  cursor: pointer;
}
.starter-card__open:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}
</style>
