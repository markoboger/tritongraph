<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { highlightScalaInline } from '../highlight/shikiHighlighter'

const props = defineProps<{
  code: string
  /**
   * Keep narrow at first: the diagram signatures are Scala declarations today.
   * If/when we highlight other languages, widen this union and add new helpers.
   */
  lang?: 'scala'
}>()

const html = ref<string>('')

const effectiveLang = computed(() => props.lang ?? 'scala')

async function render() {
  const code = String(props.code ?? '').trimEnd()
  if (!code) {
    html.value = ''
    return
  }
  // Currently only Scala is supported.
  if (effectiveLang.value === 'scala') {
    html.value = await highlightScalaInline(code)
    return
  }
  html.value = code
}

onMounted(() => void render())
watch(() => [props.code, props.lang], () => void render())
</script>

<template>
  <span v-if="html" class="shiki-inline" v-html="html" />
  <span v-else class="shiki-inline shiki-inline--empty" />
</template>

<style scoped>
/**
 * Shiki returns a `<pre class="shiki">…</pre>` snippet. For our use-case this is a one-liner
 * in a box header: remove the code-block look and make it behave like inline text.
 */
.shiki-inline :deep(pre.shiki) {
  margin: 0;
  padding: 0;
  background: transparent !important;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: inherit;
  line-height: inherit;
}
.shiki-inline :deep(pre.shiki code) {
  padding: 0;
  background: transparent !important;
}
.shiki-inline :deep(.line) {
  display: inline;
}
.shiki-inline :deep(.line span) {
  display: inline;
}
</style>

