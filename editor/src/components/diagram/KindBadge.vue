<script setup lang="ts">
const props = defineProps<{
  text: string
  title?: string
  accent?: string
  size?: 'sm' | 'md'
}>()
</script>

<template>
  <span
    class="kind-badge"
    :class="props.size === 'sm' ? 'kind-badge--sm' : 'kind-badge--md'"
    :title="props.title ?? ''"
    :style="props.accent ? { '--box-accent': props.accent } : undefined"
    aria-hidden="true"
  >{{ props.text }}</span>
</template>

<style scoped>
.kind-badge {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  background: var(--box-accent, steelblue);
  color: #fff;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.02em;
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.18), 0 1px 2px rgb(15 23 42 / 0.18);
}

.kind-badge--md {
  width: 36px;
  height: 36px;
  font-size: 0.95rem;
}

.kind-badge--sm {
  width: 32px;
  height: 32px;
  font-size: 0.9rem;
}
</style>

