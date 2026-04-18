<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as monaco from 'monaco-editor'

const props = defineProps<{
  /** Last accepted / loaded YAML (left / original in diff). */
  original: string
  /** Current diagram YAML (right / modified in diff). */
  modified: string
}>()

const host = ref<HTMLElement | null>(null)
const editor = shallowRef<monaco.editor.IStandaloneDiffEditor | null>(null)
let resizeObserver: ResizeObserver | null = null

function layout() {
  editor.value?.layout()
}

onMounted(() => {
  const el = host.value
  if (!el) return

  editor.value = monaco.editor.createDiffEditor(el, {
    readOnly: true,
    /** Inline diff; without this, Monaco still shows two line-number columns (original | modified). */
    renderSideBySide: false,
    experimental: {
      useTrueInlineView: true,
    },
    renderMarginRevertIcon: false,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: 'on',
    glyphMargin: false,
    folding: true,
    wordWrap: 'on',
  })

  const originalModel = monaco.editor.createModel(props.original ?? '', 'yaml')
  const modifiedModel = monaco.editor.createModel(props.modified ?? '', 'yaml')
  editor.value.setModel({ original: originalModel, modified: modifiedModel })

  resizeObserver = new ResizeObserver(() => layout())
  resizeObserver.observe(el)
})

watch(
  () => [props.original, props.modified],
  () => {
    const d = editor.value
    if (!d) return
    const m = d.getModel()
    if (!m) return
    const o = m.original.getValue()
    const n = m.modified.getValue()
    if (o !== (props.original ?? '')) m.original.setValue(props.original ?? '')
    if (n !== (props.modified ?? '')) m.modified.setValue(props.modified ?? '')
    void requestAnimationFrame(() => layout())
  },
)

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  const d = editor.value
  if (d) {
    const m = d.getModel()
    m?.original.dispose()
    m?.modified.dispose()
    d.dispose()
  }
  editor.value = null
})
</script>

<template>
  <div ref="host" class="yaml-diff-host" />
</template>

<style scoped>
.yaml-diff-host {
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
}
</style>
