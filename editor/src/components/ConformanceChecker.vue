<script setup lang="ts">
/**
 * Conformance checker subpage — the thin UI deployment shape (spec §6). Checks a selectable Python
 * example against a hybrid Soll-model: either load an `ilograph.yaml`, or derive the as-is topology
 * and edit which component edges are allowed (Increment 7b). The LLM (optional) runs via the server
 * proxy so the key stays server-side. Each violation links onward to the project's diagram.
 *
 * ponytail: scope is `python-examples/` only; runtime workspaces are a documented follow-up.
 */
import { ref, computed, shallowRef } from 'vue'
import yaml from 'js-yaml'
import { check } from '../../../packages/triton-conformance/src/check'
import { observedImportsFromCodeModel } from '../../../packages/triton-conformance/src/ruleEngine'
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
import { loadExampleProject, type LoadedProject } from '../conformance/loadProject'
import { createServerLlmClient } from '../conformance/serverLlmClient'

const props = defineProps<{ runtimeBaseUrl: string }>()
const emit = defineEmits<{ openDiagram: [target: { dir: string; module: string }] }>()

const examples = listPythonExamples().filter((e) => e.root === 'python-examples')

const selectedDir = ref<string>('')
const project = shallowRef<LoadedProject | null>(null)
const entry = ref<PythonExampleEntry | null>(null)
const loading = ref(false)

const topologyMode = ref<'derive' | 'load'>('derive')
const componentDepth = ref(2)
/** Edge keys (`from->to`) the user has un-checked → forbidden in the derived Soll. */
const disabledEdges = ref<Set<string>>(new Set())
const sollYamlText = ref('')

const running = ref(false)
const error = ref<string | null>(null)
const results = ref<CheckResult[] | null>(null)
const useLlm = ref(false)

async function selectProject(): Promise<void> {
  results.value = null
  error.value = null
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
  try {
    const soll: SollModel = { topology: t, rules: rules.value }
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
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    running.value = false
  }
}

const violations = computed<ViolationRecord[]>(() => (results.value ?? []).flatMap((r) => r.violations))

const byFile = computed(() => {
  const map = new Map<string, ViolationRecord[]>()
  for (const v of violations.value) {
    const list = map.get(v.location.file) ?? []
    list.push(v)
    map.set(v.location.file, list)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
})

function openDiagram(v: ViolationRecord): void {
  if (entry.value) emit('openDiagram', { dir: entry.value.dir, module: v.location.module })
}
</script>

<template>
  <div class="conformance">
    <header class="conformance__head">
      <h1>Conformance Checker</h1>
      <p class="conformance__lead">
        Checks a Python example against a target architecture and reports violations. The
        rule-engine always runs; enable the LLM to also check semantic rules (key stays server-side).
      </p>

      <div class="conformance__controls">
        <label>
          Project
          <select v-model="selectedDir" @change="void selectProject()">
            <option value="" disabled>Select a python-example…</option>
            <option v-for="e in examples" :key="e.dir" :value="e.dir">{{ e.dir }}</option>
          </select>
        </label>
        <span v-if="loading" class="conformance__muted">parsing…</span>
      </div>
    </header>

    <section v-if="project" class="conformance__soll">
      <h2>Target topology</h2>
      <div class="conformance__controls">
        <label><input type="radio" value="derive" v-model="topologyMode" /> Derive from project</label>
        <label><input type="radio" value="load" v-model="topologyMode" /> Load ilograph.yaml</label>
      </div>

      <div v-if="topologyMode === 'derive' && derivedTopology">
        <label class="conformance__depth">
          Component depth
          <input type="number" min="1" max="5" v-model.number="componentDepth" />
        </label>
        <p class="conformance__muted">Components: {{ derivedTopology.components.join(', ') }}</p>
        <p class="conformance__muted">Allowed component edges (un-check to forbid):</p>
        <ul class="conformance__edges">
          <li v-for="e in derivedTopology.allowedEdges" :key="`${e.from}->${e.to}`">
            <label>
              <input
                type="checkbox"
                :checked="!disabledEdges.has(`${e.from}->${e.to}`)"
                @change="toggleEdge(`${e.from}->${e.to}`, ($event.target as HTMLInputElement).checked)"
              />
              {{ e.from }} → {{ e.to }}
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

      <div class="conformance__controls">
        <label><input type="checkbox" v-model="useLlm" /> Use LLM (semantic rules)</label>
        <button type="button" :disabled="running || !topology" @click="void run()">
          {{ running ? 'Checking…' : 'Run check' }}
        </button>
      </div>
    </section>

    <p v-if="error" class="conformance__error" role="alert">{{ error }}</p>

    <section v-if="results">
      <p v-if="violations.length === 0" class="conformance__ok">Conformance OK — no violations.</p>
      <div v-for="[file, fileViolations] in byFile" :key="file" class="conformance__file">
        <h2>{{ file }}</h2>
        <ul>
          <li v-for="(v, i) in fileViolations" :key="i" :class="`sev-${v.severity}`">
            <div class="conformance__row">
              <span class="badge" :class="`badge--${v.severity}`">{{ v.severity }}</span>
              <span class="badge badge--src">{{ v.source }}</span>
              <strong>{{ v.category }}</strong>
              <span class="conformance__rule">({{ v.rule_id }}<template v-if="v.location.symbol"> · {{ v.location.symbol }}</template>)</span>
              <button type="button" class="conformance__link" @click="openDiagram(v)">View diagram →</button>
            </div>
            <p class="conformance__reason">{{ v.reason }}</p>
            <p class="conformance__fix">fix: {{ v.suggestion }}</p>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.conformance { padding: 1.5rem; max-width: 60rem; margin: 0 auto; }
.conformance__lead { color: var(--triton-muted, #666); max-width: 48rem; }
.conformance__controls { display: flex; gap: 1rem; align-items: center; margin-top: 1rem; flex-wrap: wrap; }
.conformance__soll { margin-top: 1.5rem; border-top: 1px solid #eee; padding-top: 1rem; }
.conformance__muted { color: var(--triton-muted, #777); font-size: 0.9rem; margin: 0.5rem 0 0; }
.conformance__depth input { width: 3.5rem; margin-left: 0.4rem; }
.conformance__edges { list-style: none; padding: 0; margin: 0.25rem 0; }
.conformance__edges li { padding: 0.1rem 0; }
.conformance__yaml { width: 100%; font-family: monospace; font-size: 0.85rem; margin-top: 0.5rem; }
.conformance__error { color: #b00020; }
.conformance__ok { color: #1b7f3b; font-weight: 600; }
.conformance__file { margin-top: 1.25rem; }
.conformance__file ul { list-style: none; padding: 0; }
.conformance__file li { border-left: 3px solid #ccc; padding: 0.5rem 0.75rem; margin: 0.5rem 0; }
.conformance__file li.sev-error { border-left-color: #b00020; }
.conformance__file li.sev-warning { border-left-color: #d98e00; }
.conformance__row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.badge { font-size: 0.7rem; text-transform: uppercase; padding: 0.1rem 0.4rem; border-radius: 0.25rem; background: #eee; }
.badge--error { background: #fbe0e3; color: #b00020; }
.badge--warning { background: #fbf0d6; color: #8a5b00; }
.badge--src { background: #e6eefb; color: #2a4d8f; }
.conformance__rule { color: #777; font-size: 0.85rem; }
.conformance__reason { margin: 0.35rem 0 0; }
.conformance__fix { margin: 0.15rem 0 0; color: #1b7f3b; font-size: 0.9rem; }
.conformance__link { margin-left: auto; background: none; border: none; color: #2a4d8f; cursor: pointer; }
</style>
