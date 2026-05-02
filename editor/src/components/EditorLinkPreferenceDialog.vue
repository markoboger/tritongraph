<script setup lang="ts">
import { ref, watch } from 'vue'
import type { StoredExternalEditorId } from '../store/editorLinkPreference'

const props = defineProps<{
  open: boolean
  /** Tab key used for persistence (shown for context only). */
  workspaceKey: string
  suggestedRepoRoot: string
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  internal: []
  external: [{ editor: StoredExternalEditorId; repoRoot: string }]
}>()

const step = ref<1 | 2>(1)
const repoRootInput = ref('')
const editorChoice = ref<StoredExternalEditorId>('cursor')

watch(
  () => props.open,
  (v) => {
    if (v) {
      step.value = 1
      repoRootInput.value = props.suggestedRepoRoot
      editorChoice.value = 'cursor'
    }
  },
)

function close(): void {
  emit('update:open', false)
}

function chooseInternal(): void {
  emit('internal')
  close()
}

function confirmExternal(): void {
  const root = repoRootInput.value.trim()
  if (!root) return
  emit('external', { editor: editorChoice.value, repoRoot: root })
  close()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="editor-link-dialog-root"
      role="presentation"
      @keydown.escape.prevent="close"
    >
      <div class="editor-link-dialog-backdrop" aria-hidden="true" @click="close" />
      <dialog class="editor-link-dialog" open aria-modal="true" aria-labelledby="editor-link-dialog-title">
        <template v-if="step === 1">
          <h2 id="editor-link-dialog-title" class="editor-link-dialog__title">Open source from the diagram</h2>
          <p class="editor-link-dialog__lead">
            Choose where Triton should open files when you click code in a focused box. This choice is saved for this
            workspace tab only.
          </p>
          <p v-if="workspaceKey" class="editor-link-dialog__mono">{{ workspaceKey }}</p>
          <div class="editor-link-dialog__actions editor-link-dialog__actions--stack">
            <button type="button" class="editor-link-dialog__btn editor-link-dialog__btn--primary" @click="chooseInternal">
              Internal viewer (Monaco)
            </button>
            <button type="button" class="editor-link-dialog__btn" @click="step = 2">External editor…</button>
            <button type="button" class="editor-link-dialog__btn editor-link-dialog__btn--ghost" @click="close">
              Cancel
            </button>
          </div>
        </template>
        <template v-else>
          <h2 id="editor-link-dialog-title" class="editor-link-dialog__title">External editor</h2>
          <p class="editor-link-dialog__lead">
            Absolute path to the repository root on your machine (where this project’s files live). Triton appends the
            clicked file’s relative path.
          </p>
          <label class="editor-link-dialog__label" for="editor-link-repo-root">Repository root</label>
          <input
            id="editor-link-repo-root"
            v-model="repoRootInput"
            class="editor-link-dialog__input"
            type="text"
            autocomplete="off"
            placeholder="/path/to/your/checkout"
          />
          <label class="editor-link-dialog__label" for="editor-link-which">Editor</label>
          <select id="editor-link-which" v-model="editorChoice" class="editor-link-dialog__select">
            <option value="cursor">Cursor</option>
            <option value="vscode">Visual Studio Code</option>
            <option value="vscode-insiders">VS Code Insiders</option>
            <option value="windsurf">Windsurf</option>
          </select>
          <div class="editor-link-dialog__actions">
            <button type="button" class="editor-link-dialog__btn" @click="step = 1">Back</button>
            <button
              type="button"
              class="editor-link-dialog__btn editor-link-dialog__btn--primary"
              :disabled="!repoRootInput.trim()"
              @click="confirmExternal"
            >
              Save &amp; open
            </button>
          </div>
        </template>
      </dialog>
    </div>
  </Teleport>
</template>

<style scoped>
.editor-link-dialog-root {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}
.editor-link-dialog-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
}
.editor-link-dialog {
  position: relative;
  z-index: 1;
  margin: 0;
  border: 1px solid #cbd5e1;
  border-radius: 14px;
  padding: 22px 24px;
  max-width: 440px;
  width: 100%;
  background: #fff;
  box-shadow: 0 22px 55px rgba(15, 23, 42, 0.18);
  color: #0f172a;
}
.editor-link-dialog__title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.editor-link-dialog__lead {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.5;
  color: #475569;
}
.editor-link-dialog__mono {
  margin: 0 0 16px;
  font-size: 11px;
  word-break: break-all;
  color: #64748b;
  font-family: ui-monospace, monospace;
}
.editor-link-dialog__label {
  display: block;
  margin: 14px 0 6px;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
}
.editor-link-dialog__input,
.editor-link-dialog__select {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #94a3b8;
  font: inherit;
  font-size: 14px;
}
.editor-link-dialog__actions {
  margin-top: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}
.editor-link-dialog__actions--stack {
  flex-direction: column;
  align-items: stretch;
}
.editor-link-dialog__btn {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  cursor: pointer;
}
.editor-link-dialog__btn--primary {
  background: #0d9488;
  border-color: #0f766e;
  color: #fff;
}
.editor-link-dialog__btn--primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.editor-link-dialog__btn--ghost {
  background: transparent;
  border-color: transparent;
  color: #64748b;
  font-weight: 500;
}
</style>
