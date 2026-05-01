<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as monaco from 'monaco-editor'

const props = defineProps<{
  source: string
  filePath: string
  language?: string
  line?: number
}>()

const host = ref<HTMLElement | null>(null)
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)
const model = shallowRef<monaco.editor.ITextModel | null>(null)
let resizeObserver: ResizeObserver | null = null
let activeDecorations: string[] = []

function inferLanguage(filePath: string, explicit?: string): string {
  const lang = (explicit ?? '').trim().toLowerCase()
  if (lang) return lang
  const lower = filePath.trim().toLowerCase()
  if (lower.endsWith('.scala') || lower.endsWith('.sbt')) return 'scala'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.kt')) return 'kotlin'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.jsx')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.xml')) return 'xml'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.scss')) return 'scss'
  if (lower.endsWith('.sh')) return 'shell'
  return 'plaintext'
}

function layout() {
  editor.value?.layout()
}

function applyLineFocus() {
  const ed = editor.value
  if (!ed) return
  const maxLine = ed.getModel()?.getLineCount() ?? 1
  const line = Math.max(1, Math.min(maxLine, props.line ?? 1))
  activeDecorations = ed.deltaDecorations(activeDecorations, [
    {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'source-viewer__line-highlight',
        glyphMarginClassName: 'source-viewer__line-glyph',
      },
    },
  ])
  ed.revealLineInCenter(line)
  ed.setPosition({ lineNumber: line, column: 1 })
}

onMounted(() => {
  const el = host.value
  if (!el) return

  model.value = monaco.editor.createModel(
    props.source ?? '',
    inferLanguage(props.filePath, props.language),
    monaco.Uri.parse(`file://${encodeURI(props.filePath || '/source.txt')}`),
  )
  editor.value = monaco.editor.create(el, {
    model: model.value,
    readOnly: true,
    domReadOnly: true,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on',
    glyphMargin: true,
    folding: true,
    wordWrap: 'off',
    renderLineHighlight: 'none',
    contextmenu: true,
    overviewRulerBorder: false,
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    stickyScroll: { enabled: true },
  })
  applyLineFocus()

  resizeObserver = new ResizeObserver(() => layout())
  resizeObserver.observe(el)
})

watch(
  () => [props.source, props.filePath, props.language],
  ([source, filePath, language]) => {
    const m = model.value
    if (!m) return
    if (m.getValue() !== (source ?? '')) m.setValue(source ?? '')
    monaco.editor.setModelLanguage(m, inferLanguage(filePath ?? '', language))
    void requestAnimationFrame(() => {
      layout()
      applyLineFocus()
    })
  },
)

watch(() => props.line, () => applyLineFocus())

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  activeDecorations = []
  editor.value?.dispose()
  editor.value = null
  model.value?.dispose()
  model.value = null
})
</script>

<template>
  <div class="source-viewer">
    <div class="source-viewer__meta">
      <div class="source-viewer__path">{{ filePath }}</div>
      <div class="source-viewer__line">Line {{ Math.max(1, line ?? 1) }}</div>
    </div>
    <div ref="host" class="source-viewer__host" />
  </div>
</template>

<style scoped>
.source-viewer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #fff;
}

.source-viewer__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
}

.source-viewer__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.source-viewer__line {
  flex-shrink: 0;
}

.source-viewer__host {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.source-viewer__host :deep(.source-viewer__line-highlight) {
  background: rgba(251, 191, 36, 0.18);
}

.source-viewer__host :deep(.source-viewer__line-glyph) {
  background: linear-gradient(180deg, #0f766e 0%, #14b8a6 100%);
  width: 4px !important;
  margin-left: 6px;
  border-radius: 999px;
}
</style>
