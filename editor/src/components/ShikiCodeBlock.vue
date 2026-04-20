<script setup lang="ts">
/**
 * Multi-line Shiki-rendered code block. Companion to {@link ShikiInlineCode} — that one flattens
 * Shiki's `<pre class="shiki">` wrapper to an inline run for one-line headers; this one keeps the
 * block layout so each newline renders on its own line, preserves leading whitespace, and still
 * gets the same `github-dark` theme / Scala TextMate grammar.
 *
 * Rendering is async: the Shiki wasm / theme bundle loads once (singleton in `shikiHighlighter.ts`)
 * and every subsequent call is a cheap synchronous highlight. The first frame shows the raw code
 * in a plain `<pre>` so we never flash an empty panel while the highlighter warms up.
 *
 * Per-line clickability: when the caller attaches `@line-click`, we also set
 * `clickable=true` to apply hover / cursor affordances, find the clicked `<span class="line">`
 * via event delegation on the root, and emit its 0-indexed position. Clicks that don't hit a
 * line (whitespace around the pre element, for instance) are ignored silently.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { highlightScalaInline } from '../highlight/shikiHighlighter'

const props = defineProps<{
  code: string
  /** Currently only Scala — widen when we need more languages (same pattern as ShikiInlineCode). */
  lang?: 'scala'
  /**
   * Style lines as interactive (cursor, hover tint). Set by callers that listen to
   * `line-click`; omitted when the block is purely decorative, so static code blocks don't
   * mislead users into thinking they're buttons.
   */
  clickable?: boolean
}>()

const emit = defineEmits<{
  /** 0-indexed line position within the rendered code block. */
  'line-click': [{ index: number; event: MouseEvent }]
}>()

const html = ref<string>('')

const effectiveLang = computed(() => props.lang ?? 'scala')

async function render(): Promise<void> {
  const code = String(props.code ?? '').replace(/\s+$/, '')
  if (!code) {
    html.value = ''
    return
  }
  if (effectiveLang.value === 'scala') {
    html.value = await highlightScalaInline(code)
    return
  }
  html.value = ''
}

onMounted(() => void render())
watch(() => [props.code, props.lang], () => void render())

/**
 * Delegate clicks on the rendered Shiki output back to the owning panel via `line-click`.
 *
 * Shiki emits the familiar `<pre class="shiki"><code><span class="line">…</span>…</code></pre>`
 * layout. We walk up from the click target to the nearest `.line`, then count its index among
 * sibling lines under the same `<code>` — order-preserving even when Shiki nests syntax spans.
 * Clicks that don't resolve to a line (clicks on padding, selection drags finishing outside a
 * line, …) are ignored.
 */
function onClick(ev: MouseEvent): void {
  const target = ev.target as Element | null
  if (!target) return
  const line = target.closest('.line') as HTMLElement | null
  if (!line || !line.parentElement) return
  const siblings = Array.from(line.parentElement.children).filter((c) =>
    (c as Element).classList?.contains('line'),
  )
  const index = siblings.indexOf(line)
  if (index < 0) return
  emit('line-click', { index, event: ev })
}
</script>

<template>
  <div
    v-if="html"
    class="shiki-block"
    :class="{ 'shiki-block--clickable': clickable }"
    v-html="html"
    @click="onClick"
  />
  <pre v-else class="shiki-block shiki-block--fallback">{{ code }}</pre>
</template>

<style scoped>
/**
 * Shiki emits a `<pre class="shiki">…</pre>` wrapper. We accept its background / colors (that's
 * the point of theming) but flatten the outer chrome: no border, no rounded corners, no padding
 * beyond what the panel-body already provides, so the code block reads as part of the enclosing
 * compartment rather than an inset card.
 *
 * Horizontal scroll strategy: the outer `.shiki-block` is the designated scroll container
 * (`overflow: auto`). The inner `<pre>` is sized to its content via `width: max-content`, so
 * lines that exceed the block width push the pre past the block's box; the block's overflow
 * then produces a horizontal scrollbar at the bottom of the code (rather than letting the
 * ancestor panel-body grab the scroll, which would scroll the rest of the panel along with
 * the code).
 */
.shiki-block {
  margin: 0;
  border: 0;
  border-radius: 0;
  overflow: auto;
  /** Cap at the parent width so long lines scroll inside the block instead of pushing it wider. */
  max-width: 100%;
  font-size: clamp(0.58rem, min(1.25vmin, 1.85cqh), 0.72rem);
  /**
   * Keep stacked signatures dense: `1.05` still gives descenders (`p`, `y`) enough room without
   * the chunky double-space that `1.2`+ produces — lines read as a continuous inventory rather
   * than a list with visible inter-row gaps.
   */
  line-height: 1.05;
}
.shiki-block :deep(pre.shiki) {
  margin: 0;
  /**
   * Tight padding so the code reads as continuous with the panel header above it — 1px top/
   * bottom kills the chunky gap between the "Arguments"/"Methods" label and the first line,
   * 6px sides keep the first character from touching the panel's left edge.
   */
  padding: 1px 6px 2px;
  background: transparent !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: inherit;
  line-height: inherit;
  white-space: pre;
  /**
   * Size to the widest line: `max-content` makes pre grow to fit its longest line,
   * `min-width: 100%` makes it still fill the block when all lines are short. Combined with
   * `.shiki-block { overflow: auto }` above, long signatures produce a horizontal scrollbar
   * on the block itself instead of clipping or spilling into the ancestor panel.
   */
  width: max-content;
  min-width: 100%;
  overflow: visible;
}
.shiki-block :deep(pre.shiki code) {
  padding: 0;
  background: transparent !important;
}
.shiki-block :deep(.line) {
  display: block;
  /** Kill Shiki's built-in empty-line min-height trick so consecutive signatures sit tight. */
  min-height: 0;
  padding: 0;
}
/**
 * Per-line click affordance — only active when the caller passes `clickable`. A subtle
 * accent background on hover / focus tells the user the line is actionable without
 * introducing a button chrome that would fight with the Shiki syntax colours.
 */
.shiki-block--clickable :deep(.line) {
  cursor: pointer;
  transition: background-color 120ms ease;
}
.shiki-block--clickable :deep(.line:hover) {
  background: rgb(59 130 246 / 0.12);
}

/** First-paint fallback before the highlighter resolves — match dark-theme look so it doesn't flash white. */
.shiki-block--fallback {
  padding: 8px 10px;
  background: rgb(15 23 42 / 0.04);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre;
  overflow: auto;
  max-width: 100%;
}
</style>
