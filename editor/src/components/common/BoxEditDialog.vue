<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

defineProps<{
  dialogLabel: string
  descriptionPlaceholder: string
  modelValueLabel: string
  modelValueDescription: string
}>()

const emit = defineEmits<{
  'update:modelValueLabel': [string]
  'update:modelValueDescription': [string]
  save: []
  cancel: []
}>()

const labelInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  void nextTick(() => {
    const el = labelInput.value
    if (!el) return
    el.focus()
    el.select()
  })
})

function onLabelKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Enter') {
    ev.preventDefault()
    emit('save')
  } else if (ev.key === 'Escape') {
    ev.preventDefault()
    emit('cancel')
  }
}

function onDescriptionKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    emit('cancel')
  }
}
</script>

<template>
  <div
    class="box-edit-dialog nodrag nopan"
    role="dialog"
    :aria-label="dialogLabel"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @keydown.stop
  >
    <label class="editor-field">
      <span class="editor-label">Name</span>
      <input
        ref="labelInput"
        :value="modelValueLabel"
        class="title-input"
        spellcheck="false"
        @input="emit('update:modelValueLabel', ($event.target as HTMLInputElement).value)"
        @keydown="onLabelKeydown"
      />
    </label>
    <label class="editor-field">
      <span class="editor-label">Description / AI prompt purpose</span>
      <textarea
        :value="modelValueDescription"
        class="description-input"
        rows="5"
        spellcheck="false"
        :placeholder="descriptionPlaceholder"
        @input="emit('update:modelValueDescription', ($event.target as HTMLTextAreaElement).value)"
        @keydown="onDescriptionKeydown"
      />
    </label>
    <div class="editor-actions">
      <span class="edit-hint">Enter in name to save · Esc to cancel</span>
      <button type="button" class="editor-btn" @click="emit('cancel')">Cancel</button>
      <button type="button" class="editor-btn editor-btn--primary" @click="emit('save')">Save</button>
    </div>
  </div>
</template>

<style scoped>
.box-edit-dialog {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 50;
  width: max(280px, 100%);
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid var(--box-accent);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgb(15 23 42 / 0.18), 0 2px 6px rgb(15 23 42 / 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
  cursor: auto;
  text-align: left;
}

.editor-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.editor-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  font-weight: 600;
}

.title-input {
  font-family: inherit;
  font-weight: 600;
  font-size: 14px;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 5px 8px;
  background: #fff;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.description-input {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  line-height: 1.45;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 6px 8px;
  background: #fff;
  outline: none;
  resize: vertical;
  min-height: 80px;
  max-height: 240px;
  width: 100%;
  box-sizing: border-box;
}

.description-input:focus,
.title-input:focus {
  border-color: var(--box-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--box-accent) 20%, transparent);
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}

.edit-hint {
  font-size: 10px;
  color: #94a3b8;
  font-style: italic;
  margin-right: auto;
}

.editor-btn {
  font-family: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: #f1f5f9;
  color: #0f172a;
  cursor: pointer;
}

.editor-btn:hover {
  background: #e2e8f0;
}

.editor-btn--primary {
  background: var(--box-accent);
  border-color: var(--box-accent);
  color: #fff;
}

.editor-btn--primary:hover {
  filter: brightness(0.95);
}
</style>
