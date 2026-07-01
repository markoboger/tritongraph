<script setup lang="ts">
/**
 * Conformance checker subpage — the thin UI deployment shape (spec §6). Checks a selectable Python
 * example against a hybrid Soll-model: either load an `ilograph.yaml`, or derive the as-is topology
 * and edit which component edges are allowed (Increment 7b). The LLM (optional) runs via the server
 * proxy so the key stays server-side. Each violation links onward to the project's diagram.
 *
 * ponytail: scope is `python-examples/` only; runtime workspaces are a documented follow-up.
 */
import { ref, computed, onMounted, shallowRef } from 'vue'
import yaml from 'js-yaml'
import { check } from '../../../packages/triton-conformance/src/check'
import { observedImportsFromCodeModel, runRuleEngine } from '../../../packages/triton-conformance/src/ruleEngine'
import { deriveTopologyFromCodeModel } from '../../../packages/triton-conformance/src/deriveTopology'
import { resolveTopology } from '../../../packages/triton-conformance/src/topology'
import { summaryToChangedFact } from '../../../packages/triton-conformance/src/astExtractor'
import { defaultRules, parseArchitectureRules } from '../../../packages/triton-conformance/src/rules'
import type {
  CheckResult,
  ViolationRecord,
  ResolvedTopology,
  SollModel,
  ArchitectureRule,
} from '../../../packages/triton-conformance/src/types'
import type { IlographDocument } from '../../../packages/triton-core/src/ilographTypes'
import { listPythonExamples, type PythonExampleEntry } from '../python/pythonExampleDiagrams'
import {
  fetchChangedPythonFiles,
  fetchRuntimeRepos,
  loadExampleProject,
  loadRuntimeWorkspaceBaseProject,
  loadRuntimeWorkspaceProject,
  type LoadedProject,
  type RuntimeRepoOption,
} from '../conformance/loadProject'
import { splitViolationsByHistory, type ViolationHistory } from '../conformance/violationHistory'
import { createServerLlmClient } from '../conformance/serverLlmClient'

const props = defineProps<{ runtimeBaseUrl: string }>()

/** Where a finding's "View diagram" link should navigate, plus the node(s)/edge to focus. */
type DiagramFocus = { component: string; toComponent?: string }
type OpenDiagramTarget =
  | { kind: 'example'; dir: string; focus: DiagramFocus }
  | { kind: 'repository'; workspacePath: string; workspaceName: string; focus: DiagramFocus }
const emit = defineEmits<{ openDiagram: [target: OpenDiagramTarget] }>()

const examples = listPythonExamples().filter((e) => e.root === 'python-examples')

/** `example` = a bundled python-example; `repository` = a local repo added via the runtime. */
const projectSource = ref<'example' | 'repository'>('example')
const selectedDir = ref<string>('')
const project = shallowRef<LoadedProject | null>(null)
const entry = ref<PythonExampleEntry | null>(null)
const loading = ref(false)

// Repository source: the local repos the runtime knows about, plus a free-form path.
const repos = ref<RuntimeRepoOption[]>([])
const selectedRepoPath = ref('')
const manualRepoPath = ref('')
/** The runtime workspace backing `project` when the source is a repository (for the git base later). */
const loadedWorkspace = ref<RuntimeRepoOption | null>(null)

onMounted(async () => {
  repos.value = await fetchRuntimeRepos(props.runtimeBaseUrl).catch(() => [])
})

const topologyMode = ref<'derive' | 'load'>('derive')
const componentDepth = ref(2)
/** Edge keys (`from->to`) the user has un-checked → forbidden in the derived Soll. */
const disabledEdges = ref<Set<string>>(new Set())
const sollYamlText = ref('')

const running = ref(false)
const error = ref<string | null>(null)
const results = ref<CheckResult[] | null>(null)
const useLlm = ref(false)

/** Phase 3: for repositories, split violations into new/legacy/fixed against the previous commit (HEAD~1). */
const historyMode = ref(false)
const history = ref<ViolationHistory | null>(null)

async function selectProject(): Promise<void> {
  results.value = null
  error.value = null
  history.value = null
  historyMode.value = false
  loadedWorkspace.value = null
  const hit = examples.find((e) => e.dir === selectedDir.value)
  entry.value = hit ?? null
  project.value = null
  if (!hit) return
  loading.value = true
  try {
    project.value = await loadExampleProject(hit)
    disabledEdges.value = new Set()
  } catch (err) {
    error.value = `Failed to parse project: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    loading.value = false
  }
}

async function loadRepository(): Promise<void> {
  results.value = null
  error.value = null
  history.value = null
  entry.value = null
  project.value = null
  loadedWorkspace.value = null
  const workspacePath = (selectedRepoPath.value || manualRepoPath.value).trim()
  if (!workspacePath) return
  const known = repos.value.find((r) => r.workspacePath === workspacePath)
  const workspaceName = known?.workspaceName || workspacePath.split(/[\\/]/).filter(Boolean).pop() || 'workspace'
  loading.value = true
  try {
    project.value = await loadRuntimeWorkspaceProject(props.runtimeBaseUrl, workspacePath, workspaceName)
    loadedWorkspace.value = { workspacePath, workspaceName }
    disabledEdges.value = new Set()
  } catch (err) {
    error.value = `Failed to load repository: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    loading.value = false
  }
}

/** Reset the loaded project when the user switches between example and repository sources. */
function onSourceChange(): void {
  results.value = null
  error.value = null
  history.value = null
  historyMode.value = false
  project.value = null
  entry.value = null
  loadedWorkspace.value = null
}

const derivedTopology = computed<ResolvedTopology | null>(() =>
  project.value ? deriveTopologyFromCodeModel(project.value.codeModel, { componentDepth: componentDepth.value }) : null,
)

/** The effective Soll topology: derived-with-toggles, or the loaded ilograph.yaml. */
const topology = computed<ResolvedTopology | null>(() => {
  if (topologyMode.value === 'load') return loadedTopology.value
  const derived = derivedTopology.value
  if (!derived) return null
  return {
    ...derived,
    allowedEdges: derived.allowedEdges.filter((e) => !disabledEdges.value.has(`${e.from}->${e.to}`)),
  }
})

const loadedTopology = computed<ResolvedTopology | null>(() => {
  if (topologyMode.value !== 'load' || sollYamlText.value.trim() === '') return null
  try {
    const doc = yaml.load(sollYamlText.value) as IlographDocument
    return resolveTopology(doc)
  } catch {
    return null
  }
})

const projectRulesText = computed<string | null>(() => {
  const files = entry.value?.files ?? {}
  const key = Object.keys(files).find((k) => k.endsWith('architecture-rules.yaml'))
  return key ? files[key]! : null
})

const rules = computed<ArchitectureRule[]>(() => {
  const t = topology.value
  if (!t) return []
  const text = projectRulesText.value
  if (text) {
    try {
      return parseArchitectureRules(yaml.load(text))
    } catch {
      return defaultRules(t)
    }
  }
  return defaultRules(t)
})

const rulesSource = computed(() => (projectRulesText.value ? 'project architecture-rules.yaml' : 'built-in default'))

function toggleEdge(key: string, allowed: boolean): void {
  const next = new Set(disabledEdges.value)
  if (allowed) next.delete(key)
  else next.add(key)
  disabledEdges.value = next
}

async function run(): Promise<void> {
  const t = topology.value
  if (!project.value || !t) {
    error.value = topologyMode.value === 'load' ? 'Load a valid ilograph.yaml first.' : 'Select a project first.'
    return
  }
  running.value = true
  error.value = null
  results.value = null
  history.value = null
  try {
    const soll: SollModel = { topology: t, rules: rules.value }
    if (historyMode.value && loadedWorkspace.value) {
      history.value = await runWithHistory(soll, t)
    } else {
      const changedFacts = project.value.summaries.map(({ summary }) =>
        summaryToChangedFact(summary, t, 'modified'),
      )
      const llm = useLlm.value
        ? { client: createServerLlmClient(props.runtimeBaseUrl), options: { modelRequested: 'server-configured' } }
        : undefined
      results.value = await check({
        soll,
        changedFacts,
        observedImports: observedImportsFromCodeModel(project.value.codeModel),
        llm,
      })
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    running.value = false
  }
}

/**
 * Phase 3: check the current revision and its previous commit against the same target architecture and
 * split structural violations by `match_key` (new = regressions, legacy = pre-existing, fixed = removed).
 * The rule-engine runs directly on both CodeModels — deterministic and cheap. The LLM (if enabled) runs
 * only on changed files and all its findings count as new; legacy semantics are skipped (see plan).
 */
async function runWithHistory(soll: SollModel, t: ResolvedTopology): Promise<ViolationHistory> {
  const ws = loadedWorkspace.value!
  const head = project.value!
  const roots = head.pythonSourceRoots ?? []
  const base = await loadRuntimeWorkspaceBaseProject(props.runtimeBaseUrl, ws.workspacePath, ws.workspaceName, roots)

  const headImports = observedImportsFromCodeModel(head.codeModel)
  const split = splitViolationsByHistory(
    runRuleEngine(headImports, t),
    runRuleEngine(observedImportsFromCodeModel(base.codeModel), t),
  )

  if (useLlm.value) {
    const changed = await fetchChangedPythonFiles(props.runtimeBaseUrl, ws.workspacePath)
    const changedFacts = head.summaries
      .filter(({ filePath }) => changed.has(filePath))
      .map(({ summary }) => summaryToChangedFact(summary, t, 'modified'))
    if (changedFacts.length) {
      const llmResults = await check({
        soll,
        changedFacts,
        observedImports: headImports,
        llm: { client: createServerLlmClient(props.runtimeBaseUrl), options: { modelRequested: 'server-configured' } },
      })
      const llmViolations = llmResults.flatMap((r) => r.violations).filter((v) => v.source === 'llm')
      split.added = [...split.added, ...llmViolations]
    }
  }
  return split
}

const violations = computed<ViolationRecord[]>(() => (results.value ?? []).flatMap((r) => r.violations))

function groupByFile(list: readonly ViolationRecord[]): [string, ViolationRecord[]][] {
  const map = new Map<string, ViolationRecord[]>()
  for (const v of list) {
    const list2 = map.get(v.location.file) ?? []
    list2.push(v)
    map.set(v.location.file, list2)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const byFile = computed(() => groupByFile(violations.value))

/** The three new/legacy/fixed buckets, each grouped by file, for the history report. */
const buckets = computed(() => {
  const h = history.value
  if (!h) return []
  return [
    { key: 'new', title: `New — introduced since HEAD~1 (${h.added.length})`, groups: groupByFile(h.added) },
    { key: 'legacy', title: `Legacy — pre-existing (${h.legacy.length})`, groups: groupByFile(h.legacy) },
    { key: 'fixed', title: `Fixed — removed since HEAD~1 (${h.fixed.length})`, groups: groupByFile(h.fixed) },
  ]
})

/** Root-cause focus from a violation: the offending edge's two components, or a single node. */
function focusForViolation(v: ViolationRecord): DiagramFocus {
  const component = v.subject.from ?? v.location.component ?? v.location.module
  return v.subject.to ? { component, toComponent: v.subject.to } : { component }
}

/** Emit "open the project's diagram" for the loaded source (bundled example or runtime repository). */
function openDiagram(v: ViolationRecord): void {
  const focus = focusForViolation(v)
  if (entry.value) {
    emit('openDiagram', { kind: 'example', dir: entry.value.dir, focus })
  } else if (loadedWorkspace.value) {
    emit('openDiagram', {
      kind: 'repository',
      workspacePath: loadedWorkspace.value.workspacePath,
      workspaceName: loadedWorkspace.value.workspaceName,
      focus,
    })
  }
}

/** True when a diagram target is available for the current source (drives the link's visibility). */
const canOpenDiagram = computed(() => !!entry.value || !!loadedWorkspace.value)
</script>

<template>
  <div class="conformance">
    <header class="conformance__head">
      <div class="conformance__head-row">
        <div class="conformance__head-icon" aria-hidden="true">C</div>
        <div>
          <h1>Conformance Checker</h1>
          <p class="conformance__lead">
            Checks a Python project against a target architecture and reports violations. The
            rule-engine always runs; enable the LLM to also check semantic rules (key stays server-side).
          </p>
        </div>
      </div>
    </header>

    <section class="conformance__card">
      <h2 class="conformance__card-title">Source</h2>
      <div class="conformance__controls conformance__segmented">
        <label><input type="radio" value="example" v-model="projectSource" @change="onSourceChange" /> Example</label>
        <label><input type="radio" value="repository" v-model="projectSource" @change="onSourceChange" /> Repository</label>
      </div>

      <div v-if="projectSource === 'example'" class="conformance__controls">
        <label>
          Project
          <select v-model="selectedDir" @change="void selectProject()">
            <option value="" disabled>Select a python-example…</option>
            <option v-for="e in examples" :key="e.dir" :value="e.dir">{{ e.dir }}</option>
          </select>
        </label>
        <span v-if="loading" class="conformance__muted">parsing…</span>
      </div>

      <div v-else class="conformance__controls">
        <label>
          Repository
          <select v-model="selectedRepoPath">
            <option value="">Select an added repository…</option>
            <option v-for="r in repos" :key="r.workspacePath" :value="r.workspacePath">
              {{ r.workspaceName }} — {{ r.workspacePath }}
            </option>
          </select>
        </label>
        <input
          v-model="manualRepoPath"
          class="conformance__repo-path"
          aria-label="Workspace path"
          placeholder="…or paste an absolute workspace path"
        />
        <button type="button" :disabled="loading || !(selectedRepoPath || manualRepoPath).trim()" @click="void loadRepository()">
          {{ loading ? 'Loading…' : 'Load repository' }}
        </button>
      </div>
    </section>

    <section v-if="project" class="conformance__soll conformance__card">
      <h2 class="conformance__card-title">Target topology</h2>
      <div class="conformance__controls conformance__segmented">
        <label><input type="radio" value="derive" v-model="topologyMode" /> Derive from project</label>
        <label><input type="radio" value="load" v-model="topologyMode" /> Load ilograph.yaml</label>
      </div>

      <div v-if="topologyMode === 'derive' && derivedTopology">
        <label class="conformance__depth">
          Component depth
          <input type="number" min="1" max="5" v-model.number="componentDepth" />
        </label>
        <div class="conformance__muted conformance__chips">
          <span>Components:</span>
          <span v-for="c in derivedTopology.components" :key="c" class="conformance__chip">{{ c }}</span>
        </div>
        <p class="conformance__muted">Allowed component edges (un-check to forbid):</p>
        <ul class="conformance__edges">
          <li v-for="e in derivedTopology.allowedEdges" :key="`${e.from}->${e.to}`">
            <label class="conformance__toggle">
              <input
                type="checkbox"
                class="conformance__toggle-input"
                :checked="!disabledEdges.has(`${e.from}->${e.to}`)"
                @change="toggleEdge(`${e.from}->${e.to}`, ($event.target as HTMLInputElement).checked)"
              />
              <span class="conformance__toggle-track" aria-hidden="true"></span>
              <span class="conformance__toggle-label">{{ e.from }} → {{ e.to }}</span>
            </label>
          </li>
          <li v-if="derivedTopology.allowedEdges.length === 0" class="conformance__muted">
            (no cross-component imports observed)
          </li>
        </ul>
      </div>

      <div v-else-if="topologyMode === 'load'">
        <textarea
          v-model="sollYamlText"
          class="conformance__yaml"
          rows="8"
          placeholder="Paste an ilograph.yaml (resources + perspectives[].relations)…"
        ></textarea>
        <p v-if="sollYamlText.trim() && !loadedTopology" class="conformance__error">Could not parse topology from YAML.</p>
      </div>

      <p class="conformance__muted">Rules: {{ rules.length }} ({{ rulesSource }})</p>
    </section>

    <section v-if="project" class="conformance__card">
      <h2 class="conformance__card-title">Run options</h2>
      <div class="conformance__controls">
        <label class="conformance__toggle">
          <input type="checkbox" class="conformance__toggle-input" v-model="useLlm" />
          <span class="conformance__toggle-track" aria-hidden="true"></span>
          <span class="conformance__toggle-label">Use LLM (semantic rules)</span>
        </label>
        <label v-if="loadedWorkspace" class="conformance__toggle">
          <input type="checkbox" class="conformance__toggle-input" v-model="historyMode" />
          <span class="conformance__toggle-track" aria-hidden="true"></span>
          <span class="conformance__toggle-label">Compare vs previous commit (new vs legacy)</span>
        </label>
        <button type="button" :disabled="running || !topology" @click="void run()">
          {{ running ? 'Checking…' : 'Run check' }}
        </button>
      </div>
      <p v-if="historyMode" class="conformance__muted">
        Structural violations are split against HEAD~1. LLM findings (if enabled) run on changed files
        only and all count as new — legacy semantics are not re-checked.
      </p>
    </section>

    <p v-if="error" class="conformance__error" role="alert">{{ error }}</p>

    <section v-if="results" class="conformance__results">
      <h2 class="conformance__results-title">Results</h2>
      <p v-if="violations.length === 0" class="conformance__ok">Conformance OK — no violations.</p>
      <div v-for="[file, fileViolations] in byFile" :key="file" class="conformance__file conformance__card">
        <h2>{{ file }}</h2>
        <ul>
          <li v-for="(v, i) in fileViolations" :key="i" :class="`sev-${v.severity}`">
            <div class="conformance__row">
              <span class="badge" :class="`badge--${v.severity}`">{{ v.severity }}</span>
              <span class="badge badge--src">{{ v.source }}</span>
              <strong>{{ v.category }}</strong>
              <span class="conformance__rule">({{ v.rule_id }}<template v-if="v.location.symbol"> · {{ v.location.symbol }}</template>)</span>
              <button v-if="canOpenDiagram" type="button" class="conformance__link" @click="openDiagram(v)">View diagram →</button>
            </div>
            <p class="conformance__reason">{{ v.reason }}</p>
            <p class="conformance__fix">fix: {{ v.suggestion }}</p>
          </li>
        </ul>
      </div>
    </section>

    <section v-if="history">
      <div v-for="b in buckets" :key="b.key" class="conformance__bucket conformance__card" :class="`conformance__bucket--${b.key}`">
        <h2>{{ b.title }}</h2>
        <p v-if="b.groups.length === 0" class="conformance__muted">(none)</p>
        <div v-for="[file, fileViolations] in b.groups" :key="file" class="conformance__file">
          <h3>{{ file }}</h3>
          <ul>
            <li v-for="(v, i) in fileViolations" :key="i" :class="`sev-${v.severity}`">
              <div class="conformance__row">
                <span class="badge" :class="`badge--${v.severity}`">{{ v.severity }}</span>
                <span class="badge badge--src">{{ v.source }}</span>
                <strong>{{ v.category }}</strong>
                <span class="conformance__rule">({{ v.rule_id }}<template v-if="v.location.symbol"> · {{ v.location.symbol }}</template>)</span>
                <button v-if="canOpenDiagram" type="button" class="conformance__link" @click="openDiagram(v)">View diagram →</button>
              </div>
              <p class="conformance__reason">{{ v.reason }}</p>
              <p class="conformance__fix">fix: {{ v.suggestion }}</p>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.conformance {
  padding: 1.5rem;
  max-width: 1040px;
  margin: 0 auto;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: #eef6f7;
  display: grid;
  gap: 22px;
  align-content: start;
}

/* Header */
.conformance__head-row { display: flex; align-items: center; gap: 14px; }
.conformance__head-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #0f172a;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 22px;
  font-weight: 700;
}
.conformance__head h1 {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 26px;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.conformance__lead { color: #55606b; max-width: 48rem; margin: 4px 0 0; font-size: 14px; line-height: 1.5; }

/* Cards */
.conformance__card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 20px 22px;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.04);
}
.conformance__card > h2,
.conformance__card-title {
  margin: 0 0 4px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}
.conformance__soll { margin-top: 0; }

.conformance__controls { display: flex; gap: 1rem; align-items: center; margin-top: 1rem; flex-wrap: wrap; }
.conformance__muted { color: #55606b; font-size: 0.9rem; margin: 0.5rem 0 0; }
.conformance__depth input { width: 3.5rem; margin-left: 0.4rem; }
.conformance__edges { list-style: none; padding: 0; margin: 0.5rem 0; display: grid; gap: 4px; }
.conformance__edges li { padding: 0.1rem 0; }
.conformance__yaml {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  margin-top: 0.5rem;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-sizing: border-box;
}
.conformance__error { color: #b42318; }
.conformance__ok { color: #15803d; font-weight: 600; }

/* Segmented control (radio pairs) */
.conformance__segmented { display: inline-flex; gap: 0; background: #eef1f4; border-radius: 9px; padding: 3px; margin-top: 1rem; }
.conformance__segmented label {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  color: #55606b;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.conformance__segmented input[type='radio'] { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.conformance__segmented label:has(input:checked) { background: #0f172a; color: #fff; }

/* Toggle switch (checkboxes) */
.conformance__toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; font-size: 14px; }
.conformance__toggle-input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.conformance__toggle-track {
  position: relative;
  flex-shrink: 0;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: #d7dee2;
  transition: background 0.15s ease;
}
.conformance__toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
  transition: transform 0.15s ease;
}
.conformance__toggle-input:checked + .conformance__toggle-track { background: #0d9488; }
.conformance__toggle-input:checked + .conformance__toggle-track::after { transform: translateX(16px); }
.conformance__toggle-input:focus-visible + .conformance__toggle-track { outline: 2px solid #0ea5e9; outline-offset: 2px; }

/* Chips */
.conformance__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.conformance__chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  background: #eef1f4;
  color: #33404a;
  font-size: 12px;
  font-weight: 600;
}

/* Results */
.conformance__results-title { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #0f172a; }
.conformance__bucket { margin-top: 0; padding-left: 1rem; border-left: 4px solid #ccc; }
.conformance__bucket--new { border-left-color: #dc2626; }
.conformance__bucket--legacy { border-left-color: #94a3b8; }
.conformance__bucket--fixed { border-left-color: #16a34a; }
.conformance__bucket h3 { font-size: 0.95rem; margin: 0.75rem 0 0; }
.conformance__file { margin-top: 1.25rem; }
.conformance__file:first-child { margin-top: 0; }
.conformance__file ul { list-style: none; padding: 0; }
.conformance__file li { border-left: 3px solid #ccc; padding: 0.5rem 0.75rem; margin: 0.5rem 0; }
.conformance__file li.sev-error { border-left-color: #b42318; }
.conformance__file li.sev-warning { border-left-color: #92620a; }
.conformance__row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }

.badge { font-size: 0.7rem; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: #eef1f4; color: #55606b; font-weight: 700; letter-spacing: 0.03em; }
.badge--error { background: #fde2e1; color: #b42318; }
.badge--warning { background: #fdf0d5; color: #92620a; }
.badge--src { background: #eef1f4; color: #55606b; }
.conformance__rule { color: #55606b; font-size: 0.85rem; }
.conformance__reason { margin: 0.35rem 0 0; }
.conformance__fix { margin: 0.15rem 0 0; color: #15803d; font-size: 0.9rem; }

/* Generic element styling (buttons, selects, inputs) */
.conformance button {
  border: 1px solid #0d9488;
  background: #0d9488;
  color: #fff;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.conformance button:hover:not(:disabled) { background: #0f766e; border-color: #0f766e; }
.conformance button:disabled { opacity: 0.5; cursor: not-allowed; }
.conformance button.conformance__link {
  margin-left: auto;
  background: none;
  border: none;
  color: #0d9488;
  padding: 0;
  font-weight: 600;
}
.conformance button.conformance__link:hover:not(:disabled) { background: none; color: #0f766e; }
.conformance select,
.conformance__repo-path {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
}
</style>
