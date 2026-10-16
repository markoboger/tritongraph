<script lang="ts">
export interface ChoiceDialogAction {
  label: string
  value: string
  primary?: boolean
}
</script>

<script setup lang="ts">
/**
 * Small modal that asks the user to pick one of a few actions — e.g. "invalid file, OK" or
 * "work with the saved target, or start from the as-is code". Built on the native `<dialog>`, so
 * backdrop, focus trap and Escape come from the browser. Escape picks `cancelValue`.
 */
import { ref, watch, onMounted } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  message: string
  /** Monospace detail under the message, e.g. a parser error. */
  detail?: string
  actions: readonly ChoiceDialogAction[]
  /** Value emitted when the dialog is dismissed with Escape. */
  cancelValue: string
}>()

const emit = defineEmits<{ choose: [value: string] }>()

const dialogEl = ref<HTMLDialogElement | null>(null)

function syncOpenState(): void {
  const el = dialogEl.value
  if (!el) return
  if (props.open && !el.open) el.showModal()
  if (!props.open && el.open) el.close()
}

watch(() => props.open, syncOpenState)
onMounted(syncOpenState)

function onCancel(event: Event): void {
  event.preventDefault()
  emit('choose', props.cancelValue)
}
</script>

<template>
  <dialog ref="dialogEl" class="choice-dialog" aria-labelledby="choice-dialog-title" @cancel="onCancel">
    <h2 id="choice-dialog-title" class="choice-dialog__title">{{ title }}</h2>
    <p class="choice-dialog__message">{{ message }}</p>
    <pre v-if="detail" class="choice-dialog__detail">{{ detail }}</pre>
    <div class="choice-dialog__actions">
      <button
        v-for="action in actions"
        :key="action.value"
        type="button"
        class="choice-dialog__btn"
        :class="{ 'choice-dialog__btn--primary': action.primary }"
        :autofocus="action.primary"
        @click="emit('choose', action.value)"
      >
        {{ action.label }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.choice-dialog {
  max-width: min(520px, calc(100vw - 32px));
  padding: 22px 24px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
  color: #0f172a;
}
.choice-dialog::backdrop { background: rgba(15, 23, 42, 0.35); }
.choice-dialog__title {
  margin: 0 0 8px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 20px;
}
.choice-dialog__message { margin: 0; color: #55606b; font-size: 14px; line-height: 1.5; }
.choice-dialog__detail {
  margin: 12px 0 0;
  padding: 10px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #991b1b;
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.choice-dialog__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.choice-dialog__btn {
  padding: 7px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.choice-dialog__btn:hover { background: #f1f5f9; }
.choice-dialog__btn--primary { background: #0d9488; border-color: #0d9488; color: #fff; }
.choice-dialog__btn--primary:hover { background: #0f766e; border-color: #0f766e; }
</style>
