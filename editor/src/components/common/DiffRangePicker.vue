<script setup lang="ts">
/**
 * Base / head / mode inputs for the git diff. Edits stay a draft until "Apply", so typing a ref
 * does not reload a large workspace on every keystroke. Suggestions: branches, tags and the recent
 * commits of the drafted head (or HEAD), so two commits of one branch are a pick, not a copy-paste.
 */
import { computed, ref, watch } from 'vue'
import { diffRangeFor, setDiffRange, type DiffRange } from '../../conformance/diffRange'

const props = defineProps<{ runtimeUrl: string; workspacePath: string }>()

const draft = ref<DiffRange>(diffRangeFor(props.workspacePath))
watch(
  () => [props.workspacePath, diffRangeFor(props.workspacePath)] as const,
  ([, applied]) => (draft.value = { ...applied }),
)

const refs = ref<string[]>([])
const commits = ref<{ sha: string; subject: string }[]>([])
const datalistId = `diff-range-refs-${Math.random().toString(36).slice(2)}`

async function loadSuggestions(head: string): Promise<void> {
  const url = new URL(`${props.runtimeUrl.replace(/\/$/, '')}/api/workspace/git-refs`)
  url.searchParams.set('workspacePath', props.workspacePath)
  if (head) url.searchParams.set('ref', head)
  try {
    const body = (await (await fetch(url.toString())).json()) as {
      ok?: boolean
      refs?: string[]
      commits?: { sha: string; subject: string }[]
    }
    if (!body.ok) return // half-typed head — keep the previous suggestions
    refs.value = body.refs ?? []
    commits.value = body.commits ?? []
  } catch {
    // Runtime unreachable — the inputs still accept free text.
  }
}

watch(() => [props.workspacePath, draft.value.head] as const, ([, head]) => void loadSuggestions(head), {
  immediate: true,
})

const dirty = computed(() => {
  const applied = diffRangeFor(props.workspacePath)
  return (['base', 'head', 'mode'] as const).some((k) => draft.value[k].trim() !== applied[k])
})

function apply(): void {
  const base = draft.value.base.trim()
  if (!base) return
  setDiffRange(props.workspacePath, { base, head: draft.value.head.trim(), mode: draft.value.mode })
}
</script>

<template>
  <form class="diff-range" @submit.prevent="apply">
    <label class="diff-range__field" title="Branch, tag or commit the diff starts from">
      <span class="diff-range__label">Base</span>
      <input v-model="draft.base" :list="datalistId" placeholder="main" spellcheck="false" />
    </label>
    <label class="diff-range__field" title="Branch, tag or commit to inspect; empty = working tree">
      <span class="diff-range__label">Head</span>
      <input v-model="draft.head" :list="datalistId" placeholder="working tree" spellcheck="false" />
    </label>
    <select
      v-model="draft.mode"
      class="diff-range__mode"
      aria-label="Diff mode"
      title="PR: changes since head branched off base (merge-base). Direct: the two states as they are."
    >
      <option value="merge-base">PR</option>
      <option value="direct">Direct</option>
    </select>
    <button type="submit" class="diff-range__apply" :disabled="!dirty || !draft.base.trim()">Apply</button>
    <datalist :id="datalistId">
      <option v-for="name in refs" :key="name" :value="name" />
      <option v-for="c in commits" :key="c.sha" :value="c.sha">{{ c.sha }} – {{ c.subject }}</option>
    </datalist>
  </form>
</template>

<style scoped>
.diff-range {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #334155;
}
.diff-range__field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.diff-range__label {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.diff-range__field input {
  width: 130px;
  margin: 0;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.diff-range__mode,
.diff-range__apply {
  font-size: 12px;
}
</style>
