<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { StarterCard, StarterCardKind } from '../triton/tritonStarterCard'

type StarterFoldSection = {
  id: 'scala' | 'ts' | 'sbt' | 'dojo'
  title: string
  hint: string
  cards: StarterCard[]
}
import stackedCubesIconUrl from '../assets/language-icons/stacked-cubes.svg'
import cubeIconUrl from '../assets/language-icons/cube.svg'
import sbtIconUrl from '../assets/language-icons/sbt.svg'
import typescriptIconUrl from '../assets/language-icons/typescript.svg'
import genericIconUrl from '../assets/language-icons/generic.svg'

export type RuntimeHomeRepo = {
  workspacePath: string
  workspaceName: string
  probe?: { kind?: string }
  lastOpenedAt?: string
}

export type RuntimeHomeModel = {
  ok?: boolean
  error?: string
  runtime?: {
    publicRuntimeUrl?: string
    editorUrl?: string
    allowedRepoRoots?: string[]
  }
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
const homeModel = ref<RuntimeHomeModel | null>(null)
const loadError = ref('')
const submitError = ref('')
const cardError = ref('')
const formBusy = ref(false)
const analyzingPath = ref('')
const lastResultJson = ref('')
/** Repositories added from “Add new Repository” this session (shown first in the grid). */
const sessionRepos = ref<RuntimeHomeRepo[]>([])
/** Paths we know `/api/analysis/local` has succeeded for this session (or listed in recent). */
const locallyAnalyzedPaths = ref<Set<string>>(new Set())

const base = computed(() => props.runtimeBaseUrl.replace(/\/$/, ''))

function markAnalyzed(path: string): void {
  const next = new Set(locallyAnalyzedPaths.value)
  next.add(path)
  locallyAnalyzedPaths.value = next
}

function wasOpenedOrAnalyzed(path: string): boolean {
  if (locallyAnalyzedPaths.value.has(path)) return true
  return !!(homeModel.value?.recentRepos?.some((r) => r.workspacePath === path))
}

function pushSessionRepo(repo: RuntimeHomeRepo): void {
  sessionRepos.value = [
    { ...repo },
    ...sessionRepos.value.filter((r) => r.workspacePath !== repo.workspacePath),
  ]
}

function mergeFromHome(r: RuntimeHomeRepo): RuntimeHomeRepo {
  const fr = homeModel.value?.recentRepos?.find((x) => x.workspacePath === r.workspacePath)
  return { ...fr, ...r }
}

const repositoryCards = computed(() => {
  const seen = new Set<string>()
  const out: RuntimeHomeRepo[] = []
  for (const r of sessionRepos.value) {
    if (seen.has(r.workspacePath)) continue
    seen.add(r.workspacePath)
    out.push(mergeFromHome(r))
  }
  for (const r of homeModel.value?.recentRepos ?? []) {
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

function starterIconUrl(kind: StarterCardKind): string {
  switch (kind) {
    case 'dojo':
      return cubeIconUrl
    case 'yaml':
      return genericIconUrl
    case 'sbt':
      return sbtIconUrl
    case 'ts':
      return typescriptIconUrl
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
}
type AnalysisFail = { ok: false; error: string; body?: Record<string, unknown> }

async function postLocalAnalysis(workspacePath: string): Promise<AnalysisOk | AnalysisFail> {
  const path = workspacePath.trim()
  lastResultJson.value = ''
  if (!path) {
    return { ok: false, error: 'Please enter an absolute repository path.' }
  }
  try {
    const res = await fetch(`${base.value}/api/analysis/local`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: path }),
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

async function addRepositoryFromForm(): Promise<void> {
  submitError.value = ''
  lastResultJson.value = ''
  const path = workspacePathInput.value.trim()
  if (!path) {
    submitError.value = 'Please enter an absolute repository path.'
    return
  }
  formBusy.value = true
  try {
    const result = await postLocalAnalysis(path)
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
  } finally {
    formBusy.value = false
  }
}

async function ensureAnalyzedForOpen(workspacePath: string): Promise<AnalysisOk | null> {
  if (wasOpenedOrAnalyzed(workspacePath)) {
    const card = repositoryCards.value.find((r) => r.workspacePath === workspacePath)
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
          Add a repository by absolute path, then open the SBT or package diagram from its card. Recent workspaces
          from the runtime appear below; bundled examples and dojos open in new tabs.
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
      </section>

      <section class="runtime-home__card runtime-home__card--add">
        <div class="runtime-home__add-head">
          <img class="runtime-home__add-icon" :src="stackedCubesIconUrl" width="32" height="32" alt="" />
          <div>
            <h2>Add new Repository</h2>
            <p class="runtime-home__add-lead">
              Registers the workspace with the runtime and adds a card below. Open diagrams from the card when you
              are ready.
            </p>
          </div>
        </div>
        <form class="runtime-home__form" @submit.prevent="void addRepositoryFromForm()">
          <label class="runtime-home__label" for="triton-runtime-path">Repository path</label>
          <input
            id="triton-runtime-path"
            v-model="workspacePathInput"
            class="runtime-home__input"
            type="text"
            name="workspacePath"
            autocomplete="off"
            placeholder="/repos/my-project"
          />
          <div class="runtime-home__actions">
            <button type="submit" class="runtime-home__btn runtime-home__btn--primary" :disabled="formBusy">
              {{ formBusy ? 'Adding…' : 'Add repository' }}
            </button>
            <button type="button" class="runtime-home__btn" :disabled="formBusy" @click="void fetchHome()">
              Refresh lists
            </button>
          </div>
        </form>
        <p v-if="submitError" class="runtime-home__error">{{ submitError }}</p>
        <details v-if="lastResultJson && submitError" class="runtime-home__details">
          <summary>Response details</summary>
          <pre class="runtime-home__pre">{{ lastResultJson }}</pre>
        </details>
      </section>

      <section class="runtime-home__deck">
        <div class="runtime-home__deck-head">
          <h2>Repositories</h2>
          <span class="runtime-home__muted">{{ repositoryCards.length }} workspace{{ repositoryCards.length === 1 ? '' : 's' }}</span>
        </div>
        <p v-if="cardError" class="runtime-home__error runtime-home__error--card">{{ cardError }}</p>
        <details v-if="lastResultJson && cardError && !submitError" class="runtime-home__details">
          <summary>Response details</summary>
          <pre class="runtime-home__pre">{{ lastResultJson }}</pre>
        </details>
        <div v-if="!repositoryCards.length" class="runtime-home__empty runtime-home__empty--deck">
          No repositories yet. Add a path above, or use Refresh after opening workspaces from other clients.
        </div>
        <div v-else class="runtime-home__grid">
          <article v-for="repo in repositoryCards" :key="repo.workspacePath" class="repo-card">
            <div class="repo-card__icon-wrap" aria-hidden="true">
              <img class="repo-card__icon" :src="stackedCubesIconUrl" width="28" height="28" alt="" />
            </div>
            <div class="repo-card__body">
              <div class="repo-card__title-row">
                <h3 class="repo-card__title">{{ repo.workspaceName }}</h3>
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
                  :disabled="!!analyzingPath"
                  @click="void openSbtDiagram(repo)"
                >
                  SBT diagram
                </button>
                <span class="repo-card__sep" aria-hidden="true">·</span>
                <button
                  type="button"
                  class="repo-card__link"
                  :disabled="!!analyzingPath"
                  @click="void openPackageDiagram(repo)"
                >
                  Package diagram
                </button>
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
                  <img class="starter-card__icon" :src="starterIconUrl(card.kind)" width="28" height="28" alt="" />
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
.runtime-home__card--add {
  border-color: #bae6fd;
  box-shadow: 0 8px 28px rgba(14, 116, 144, 0.08);
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
