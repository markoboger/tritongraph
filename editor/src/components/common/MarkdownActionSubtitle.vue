<script setup lang="ts">
import { computed } from 'vue'
import { SUBTITLE_INLINE_LINK_RE } from './subtitleMarkdownLinks'

const props = defineProps<{
  text?: string
}>()

const emit = defineEmits<{
  'link-action': [string]
}>()

interface SubtitleSegment {
  kind: 'text' | 'link'
  value: string
  href?: string
}

const segments = computed<SubtitleSegment[]>(() => {
  const text = String(props.text ?? '')
  if (!text) return []
  const out: SubtitleSegment[] = []
  let last = 0
  SUBTITLE_INLINE_LINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SUBTITLE_INLINE_LINK_RE.exec(text)) !== null) {
    if (match.index > last) out.push({ kind: 'text', value: text.slice(last, match.index) })
    out.push({ kind: 'link', value: match[1] ?? '', href: match[2] ?? '' })
    last = match.index + match[0].length
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) })
  return out
})

function onSubtitleLinkClick(href: string | undefined) {
  if (!href) return
  emit('link-action', href)
}
</script>

<template>
  <template v-for="(seg, i) in segments" :key="i">
    <button
      v-if="seg.kind === 'link'"
      type="button"
      class="subtitle-link nodrag nopan"
      :title="seg.href"
      @click.stop="onSubtitleLinkClick(seg.href)"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
    >{{ seg.value }}</button>
    <span v-else>{{ seg.value }}</span>
  </template>
</template>

<style scoped>
.subtitle-link {
  display: inline;
  font: inherit;
  color: var(--box-accent);
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.subtitle-link:hover {
  filter: brightness(0.85);
}
</style>
