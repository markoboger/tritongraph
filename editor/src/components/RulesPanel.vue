<script setup lang="ts">
/**
 * The architecture rules of a conformance check: shows them, and edits them in an explicit edit
 * mode that is only left by Save or Discard — so the check never runs on half-edited rules.
 * Importing a rules file starts an edit with the imported rules. Structural checks are not rules
 * here: they follow from the target topology and are only summarised.
 */
import { computed, ref } from 'vue'
import type { ArchitectureRule } from '../../../packages/triton-conformance/src/types'
import { newSemanticRule, ruleSetProblems, unknownScopeComponents } from '../conformance/ruleEditing'
import { readRulesYaml } from '../conformance/sollYaml'
import RuleForm from './RuleForm.vue'

const props = defineProps<{
  /** The rules the check currently uses. */
  rules: readonly ArchitectureRule[]
  /** Where `rules` come from, e.g. `.triton/architecture-rules.yaml` or `built-in default`. */
  source: string
  /** Components of the current target topology. */
  components: readonly string[]
  allowedEdgeCount: number
  /** Persists the edited rules; throws with a reason when that fails. */
  save: (rules: ArchitectureRule[]) => Promise<void>
}>()

const emit = defineEmits<{ invalidFile: [error: { fileName: string; message: string }] }>()

/** True while the rules are being edited; the parent blocks the check meanwhile. */
const editing = defineModel<boolean>('editing', { required: true })

const draft = ref<ArchitectureRule[]>([])
/** The rule open in the form: an index into `draft`, or `null` for a new rule. */
const form = ref<{ index: number | null; rule: ArchitectureRule } | null>(null)
const saving = ref(false)
const saveError = ref<string | null>(null)

const shownRules = computed(() => (editing.value ? draft.value : props.rules))

function startEditing(rules: readonly ArchitectureRule[]): void {
  draft.value = [...rules]
  form.value = null
  saveError.value = null
  editing.value = true
}

function discard(): void {
  editing.value = false
  form.value = null
  saveError.value = null
}

async function saveDraft(): Promise<void> {
  const problems = ruleSetProblems(draft.value)
  if (problems.length) {
    saveError.value = problems.join(' ')
    return
  }
  saving.value = true
  saveError.value = null
  try {
    await props.save(draft.value)
    editing.value = false
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

function openNewRule(): void {
  form.value = { index: null, rule: newSemanticRule(draft.value) }
}

function openRule(index: number): void {
  form.value = { index, rule: draft.value[index]! }
}

function applyForm(rule: ArchitectureRule): void {
  const index = form.value?.index ?? null
  draft.value = index === null ? [...draft.value, rule] : draft.value.map((r, i) => (i === index ? rule : r))
  form.value = null
}

function deleteRule(index: number): void {
  draft.value = draft.value.filter((_, i) => i !== index)
}

/** Rules other than the one in the form — the form checks its id against these. */
const otherRules = computed(() => draft.value.filter((_, i) => i !== form.value?.index))

/** Read a chosen rules file: a valid one starts an edit with its rules, an invalid one changes nothing. */
async function importRulesFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-importing the same file
  if (!file) return
  const text = await file.text()
  try {
    startEditing(readRulesYaml(text))
  } catch (err) {
    emit('invalidFile', { fileName: file.name, message: err instanceof Error ? err.message : String(err) })
  }
}
</script>

<template>
  <section class="rules">
    <div class="rules__head">
      <h2 class="rules__title">Architecture rules</h2>
      <span v-if="editing" class="rules__badge">editing</span>
      <span v-else class="rules__muted">{{ rules.length }} · {{ source }}</span>
      <div class="rules__head-actions">
        <label class="rules__btn rules__btn--outline">
          Import rules file…
          <input type="file" accept=".yaml,.yml" class="rules__file-input" @change="void importRulesFile($event)" />
        </label>
        <button v-if="!editing" type="button" class="rules__btn rules__btn--outline" @click="startEditing(rules)">Edit</button>
      </div>
    </div>

    <p class="rules__structural">
      <strong>Structural rules</strong> follow from the target topology: {{ components.length }} components,
      {{ allowedEdgeCount }} allowed edges. Every other import between components and every cycle is a violation.
    </p>

    <ul class="rules__list">
      <li v-for="(rule, index) in shownRules" :key="`${index}:${rule.id}`" class="rules__card">
        <RuleForm
          v-if="form && form.index === index"
          :rule="form.rule"
          :other-rules="otherRules"
          :components="components"
          @apply="applyForm"
          @cancel="form = null"
        />
        <template v-else>
          <div class="rules__card-head">
            <code class="rules__id">{{ rule.id }}</code>
            <span class="rules__tag">{{ rule.kind }}</span>
            <span class="rules__tag" :class="`rules__tag--${rule.severity}`">{{ rule.severity }}</span>
            <span class="rules__muted">{{ rule.category }}</span>
            <div v-if="editing && !form" class="rules__card-actions">
              <button type="button" class="rules__link" @click="openRule(index)">Edit</button>
              <button type="button" class="rules__link rules__link--danger" @click="deleteRule(index)">Delete</button>
            </div>
          </div>
          <p class="rules__statement">{{ rule.statement }}</p>
          <div class="rules__scope">
            <span class="rules__muted">Scope:</span>
            <code
              v-for="component in rule.scope.components"
              :key="component"
              class="rules__chip"
              :class="{ 'rules__chip--unknown': unknownScopeComponents(rule, components).includes(component) }"
            >{{ component }}</code>
          </div>
          <p v-if="unknownScopeComponents(rule, components).length" class="rules__warning">
            Not in the current target topology: {{ unknownScopeComponents(rule, components).join(', ') }}
          </p>
          <p v-if="rule.kind === 'structural'" class="rules__warning">
            Structural rules from a file are listed but not evaluated yet.
          </p>
        </template>
      </li>
      <li v-if="shownRules.length === 0 && !(form && form.index === null)" class="rules__muted">
        No rules — only the structural checks run.
      </li>
      <li v-if="form && form.index === null" class="rules__card">
        <RuleForm
          :rule="form.rule"
          :other-rules="otherRules"
          :components="components"
          @apply="applyForm"
          @cancel="form = null"
        />
      </li>
    </ul>

    <div v-if="editing" class="rules__edit-bar">
      <button type="button" class="rules__btn rules__btn--outline" :disabled="form !== null" @click="openNewRule()">
        + Add rule
      </button>
      <span v-if="saveError" class="rules__error" role="alert">Not saved: {{ saveError }}</span>
      <div class="rules__edit-bar-end">
        <button type="button" class="rules__btn" :disabled="saving" @click="discard()">Discard</button>
        <button
          type="button"
          class="rules__btn rules__btn--primary"
          :disabled="saving || form !== null"
          :title="form ? 'Apply or cancel the open rule first' : undefined"
          @click="void saveDraft()"
        >{{ saving ? 'Saving…' : 'Save rules' }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rules { display: grid; gap: 12px; }
.rules__head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.rules__title { margin: 0; font-size: 15px; font-weight: 700; color: #0f172a; }
.rules__head-actions { display: flex; gap: 8px; margin-left: auto; }
.rules__badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 12px;
  font-weight: 700;
}
.rules__muted { color: #64748b; font-size: 13px; }
.rules__structural {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
}
.rules__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.rules__card { padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
.rules__card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.rules__card-actions { display: flex; gap: 12px; margin-left: auto; }
.rules__id { font-size: 13px; font-weight: 700; color: #0f172a; }
.rules__tag {
  padding: 1px 7px;
  border-radius: 6px;
  background: #e2e8f0;
  color: #334155;
  font-size: 11.5px;
  font-weight: 600;
}
.rules__tag--error { background: #fee2e2; color: #991b1b; }
.rules__tag--warning { background: #fef3c7; color: #92400e; }
.rules__statement { margin: 8px 0; font-size: 14px; color: #1e293b; line-height: 1.5; white-space: pre-wrap; }
.rules__scope { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rules__chip { padding: 1px 7px; border-radius: 6px; background: #f0fdfa; color: #115e59; font-size: 12px; }
.rules__chip--unknown { background: #fef2f2; color: #b91c1c; text-decoration: line-through; }
.rules__warning { margin: 6px 0 0; color: #b45309; font-size: 13px; }
.rules__error { color: #b91c1c; font-size: 13px; }
.rules__edit-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.rules__edit-bar-end { display: flex; gap: 8px; margin-left: auto; }
.rules__btn {
  position: relative;
  padding: 7px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.rules__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rules__btn--outline { border-color: #0d9488; color: #0d9488; }
.rules__btn--outline:hover:not(:disabled) { background: #f0fdfa; }
.rules__btn--primary { background: #0d9488; border-color: #0d9488; color: #fff; }
.rules__btn--primary:hover:not(:disabled) { background: #0f766e; border-color: #0f766e; }
.rules__btn:focus-within { outline: 2px solid #0ea5e9; outline-offset: 2px; }
.rules__file-input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.rules__link {
  padding: 0;
  border: none;
  background: none;
  color: #0d9488;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.rules__link--danger { color: #b91c1c; }
</style>
