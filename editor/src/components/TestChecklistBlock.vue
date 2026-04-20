<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /**
   * Console-shaped suite block text (suite header, subject line, `- should …` lines, and any
   * failure messages) with newline separators.
   */
  text: string
}>()

type LineKind = 'suite' | 'subject' | 'item-pass' | 'item-fail' | 'detail'

type RenderLine = {
  kind: LineKind
  text: string
}

const lines = computed<RenderLine[]>(() => {
  const raw = String(props.text ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0)

  if (!raw.length) return []

  const out: RenderLine[] = []
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i]!
    if (i === 0) {
      out.push({ kind: 'suite', text: l })
      continue
    }
    if (i === 1) {
      out.push({ kind: 'subject', text: l })
      continue
    }
    if (l.startsWith('- ')) {
      const isFail = /\*\*\*\s*FAILED\s*\*\*\*/i.test(l)
      out.push({ kind: isFail ? 'item-fail' : 'item-pass', text: l })
      continue
    }
    // Everything else is a detail line (failure messages, stack traces, etc.).
    out.push({ kind: 'detail', text: l })
  }
  return out
})
</script>

<template>
  <!--
    Match ShikiCodeBlock’s DOM shape enough that the same "Methods" visual language applies:
    a `shiki-block` container with a `pre.shiki` and per-line spans.
  -->
  <div class="shiki-block shiki-block--console">
    <pre class="shiki"><code>
<span
  v-for="(l, i) in lines"
  :key="i"
  class="line"
  :class="`line--${l.kind}`"
>{{ l.text }}</span>
</code></pre>
  </div>
</template>

<style scoped>
/* Keep the chrome identical to `ShikiCodeBlock.vue` (no border/rounded inset card). */
.shiki-block {
  margin: 0;
  border: 0;
  border-radius: 0;
  overflow: auto;
  max-width: 100%;
  font-size: clamp(0.58rem, min(1.25vmin, 1.85cqh), 0.72rem);
  line-height: 1.05;
}
.shiki-block :deep(pre.shiki) {
  margin: 0;
  padding: 1px 6px 2px;
  background: transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: inherit;
  line-height: inherit;
  white-space: pre;
  width: max-content;
  min-width: 100%;
  overflow: visible;
}
.shiki-block :deep(pre.shiki code) {
  padding: 0;
}
.shiki-block :deep(.line) {
  display: block;
  min-height: 0;
  padding: 0;
  color: #334155;
}

/* Suite + subject: match console header feel (neutral). */
.shiki-block :deep(.line--suite),
.shiki-block :deep(.line--subject) {
  color: #0f172a;
}

/* Checklist colors requested: pass green, fail red. */
.shiki-block :deep(.line--item-pass) {
  color: #16a34a;
}
.shiki-block :deep(.line--item-fail) {
  color: #dc2626;
}

/* Error/detail lines: keep them in the "failed" color family. */
.shiki-block :deep(.line--detail) {
  color: #ef4444;
}
</style>

