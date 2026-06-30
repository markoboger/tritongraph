<script setup lang="ts">
/**
 * Conformance checker subpage — the thin UI deployment shape (spec §6). It calls the same core as
 * the CLI but does NOT measure. The LLM (optional) runs via the server proxy so the key stays
 * server-side. Each violation links onward to the diagram overview.
 *
 * ponytail: runs the bundled demo Soll-model for now (proves the end-to-end shape in the UI). Wiring
 * it to a live, parsed project + that project's diagram is the follow-up; the navigation seam
 * (open-diagram) and the core call are already real.
 */
import { ref, computed } from 'vue'
import { check } from '../../../packages/triton-conformance/src/check'
import { observedImportsFromFacts } from '../../../packages/triton-conformance/src/ruleEngine'
import type { CheckResult, ViolationRecord } from '../../../packages/triton-conformance/src/types'
import { sollModel, changedFacts } from '../../../packages/triton-conformance/fixtures/miniRepo'
import { createServerLlmClient } from '../conformance/serverLlmClient'

const props = defineProps<{ runtimeBaseUrl: string }>()
const emit = defineEmits<{ openDiagram: [location: ViolationRecord['location']] }>()

const useLlm = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const results = ref<CheckResult[] | null>(null)

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

async function run(): Promise<void> {
  running.value = true
  error.value = null
  try {
    const llm = useLlm.value
      ? { client: createServerLlmClient(props.runtimeBaseUrl), options: { modelRequested: 'server-configured' } }
      : undefined
    results.value = await check({
      soll: sollModel,
      changedFacts,
      observedImports: observedImportsFromFacts(changedFacts),
      llm,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="conformance">
    <header class="conformance__head">
      <h1>Conformance Checker</h1>
      <p class="conformance__lead">
        Checks code against the target architecture and reports violations. Runs the deterministic
        rule-engine; enable the LLM to also check semantic rules (key stays server-side).
        <em>Demo model.</em>
      </p>
      <div class="conformance__controls">
        <label><input type="checkbox" v-model="useLlm" /> Use LLM (semantic rules)</label>
        <button type="button" :disabled="running" @click="void run()">
          {{ running ? 'Checking…' : 'Run check' }}
        </button>
      </div>
    </header>

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
              <button type="button" class="conformance__link" @click="emit('openDiagram', v.location)">View diagram →</button>
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
.conformance__controls { display: flex; gap: 1rem; align-items: center; margin-top: 1rem; }
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
