<script setup lang="ts">
/**
 * Form for adding or editing one architecture rule in the rules panel. Works on a local copy and
 * only hands the rule back on Apply, once `ruleProblems` has nothing left to complain about. Kind and
 * predicate are carried over unchanged: new rules are semantic, structural ones come from files.
 */
import { computed, ref } from 'vue'
import type { ArchitectureRule, Severity } from '../../../packages/triton-conformance/src/types'
import { ruleProblems, unknownScopeComponents } from '../conformance/ruleEditing'

const props = defineProps<{
  rule: ArchitectureRule
  /** The rest of the rule set, for the unique-id check. */
  otherRules: readonly ArchitectureRule[]
  /** Components of the current target topology, offered as scope. */
  components: readonly string[]
}>()

const emit = defineEmits<{ apply: [rule: ArchitectureRule]; cancel: [] }>()

const id = ref(props.rule.id)
const category = ref(props.rule.category)
const severity = ref<Severity>(props.rule.severity)
const statement = ref(props.rule.statement)
const scope = ref<string[]>([...props.rule.scope.components])
const triedToApply = ref(false)

const draft = computed<ArchitectureRule>(() => ({
  ...props.rule,
  id: id.value.trim(),
  category: category.value.trim(),
  severity: severity.value,
  statement: statement.value.trim(),
  scope: { components: scope.value },
}))
const problems = computed(() => ruleProblems(draft.value, props.otherRules))
/** Scope entries the topology no longer has stay listed, so they can be unticked. */
const scopeChoices = computed(() => [...props.components, ...unknownScopeComponents(props.rule, props.components)])

function toggleScope(component: string, checked: boolean): void {
  scope.value = checked ? [...scope.value, component] : scope.value.filter((c) => c !== component)
}

function apply(): void {
  triedToApply.value = true
  if (problems.value.length === 0) emit('apply', draft.value)
}
</script>

<template>
  <form class="rule-form" @submit.prevent="apply">
    <div class="rule-form__row">
      <label class="rule-form__field">
        Id
        <input v-model="id" type="text" autocomplete="off" />
      </label>
      <label class="rule-form__field">
        Category
        <input v-model="category" type="text" autocomplete="off" placeholder="e.g. semantic-framework-leak" />
      </label>
      <label class="rule-form__field rule-form__field--narrow">
        Severity
        <select v-model="severity">
          <option value="error">error</option>
          <option value="warning">warning</option>
        </select>
      </label>
    </div>

    <fieldset class="rule-form__scope">
      <legend>Scope — the components this rule applies to</legend>
      <label
        v-for="component in scopeChoices"
        :key="component"
        class="rule-form__scope-item"
        :class="{ 'rule-form__scope-item--unknown': !components.includes(component) }"
      >
        <input
          type="checkbox"
          :checked="scope.includes(component)"
          @change="toggleScope(component, ($event.target as HTMLInputElement).checked)"
        />
        {{ component }}
      </label>
      <p v-if="scopeChoices.length === 0" class="rule-form__hint">The target topology has no components yet.</p>
    </fieldset>

    <label class="rule-form__field">
      Statement — what the LLM checks the code against
      <textarea v-model="statement" rows="4"></textarea>
    </label>

    <ul v-if="triedToApply && problems.length" class="rule-form__problems" role="alert">
      <li v-for="problem in problems" :key="problem">{{ problem }}</li>
    </ul>

    <div class="rule-form__actions">
      <button type="button" class="rule-form__btn" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="rule-form__btn rule-form__btn--primary">Apply</button>
    </div>
  </form>
</template>

<style scoped>
.rule-form {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid #99f6e4;
  border-radius: 10px;
  background: #f0fdfa;
}
.rule-form__row { display: flex; flex-wrap: wrap; gap: 12px; }
.rule-form__field { display: grid; gap: 4px; flex: 1 1 180px; font-size: 13px; font-weight: 600; color: #334155; }
.rule-form__field--narrow { flex: 0 1 120px; }
.rule-form input[type='text'],
.rule-form select,
.rule-form textarea {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 6px 10px;
  font: inherit;
  font-weight: 400;
  font-size: 14px;
  background: #fff;
}
.rule-form textarea { resize: vertical; }
.rule-form__scope {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 8px 12px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  max-height: 160px;
  overflow-y: auto;
}
.rule-form__scope legend { padding: 0 4px; font-size: 13px; font-weight: 600; color: #334155; }
.rule-form__scope-item { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-family: ui-monospace, monospace; }
.rule-form__scope-item--unknown { color: #b91c1c; text-decoration: line-through; }
.rule-form__hint { margin: 0; font-size: 13px; color: #64748b; }
.rule-form__problems { margin: 0; padding-left: 18px; color: #b91c1c; font-size: 13px; }
.rule-form__actions { display: flex; justify-content: flex-end; gap: 8px; }
.rule-form__btn {
  padding: 6px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.rule-form__btn--primary { background: #0d9488; border-color: #0d9488; color: #fff; }
</style>
