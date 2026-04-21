<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BoxCompartment } from '../../diagram/boxCompartments'

const props = defineProps<{
  compartments: readonly BoxCompartment[]
  variant?: 'default' | 'dense'
}>()

const visibleCompartments = computed(() =>
  (props.compartments ?? []).filter((c) => c.rows.length > 0 || (c.emptyText ?? '').trim().length > 0),
)

const expandedCompartment = ref<string | null>(null)

watch(
  () => visibleCompartments.value.map((c) => c.id).join('|'),
  () => {
    if (!expandedCompartment.value) return
    if (!visibleCompartments.value.some((c) => c.id === expandedCompartment.value)) {
      expandedCompartment.value = null
    }
  },
)

function toggleCompartment(id: string): void {
  expandedCompartment.value = expandedCompartment.value === id ? null : id
}

function compartmentGrow(compartment: BoxCompartment): number {
  const rows = Math.min(8, compartment.rows.length)
  const hasEmpty = compartment.rows.length === 0 && (compartment.emptyText ?? '').trim().length > 0
  return Math.max(1, 1 + rows * 0.22 + (hasEmpty ? 0.1 : 0))
}
</script>

<template>
  <div
    v-if="visibleCompartments.length"
    class="box-compartments"
    :class="{ 'box-compartments--dense': variant === 'dense' }"
  >
    <section
      v-for="compartment in visibleCompartments"
      :key="compartment.id"
      class="box-compartment"
      :class="{
        'box-compartment--expanded': expandedCompartment === compartment.id,
        'box-compartment--compact': expandedCompartment !== null && expandedCompartment !== compartment.id,
      }"
      :style="expandedCompartment === null ? { flexGrow: String(compartmentGrow(compartment)) } : undefined"
    >
      <button
        type="button"
        class="box-compartment__header"
        :aria-expanded="expandedCompartment === compartment.id"
        :title="
          expandedCompartment === compartment.id
            ? 'Click to restore even split'
            : 'Click to expand this section'
        "
        @click.stop="toggleCompartment(compartment.id)"
      >
        <span class="box-compartment__title">{{ compartment.title }}</span>
        <span class="box-compartment__chevron" aria-hidden="true" />
      </button>
      <div v-if="compartment.rows.length" class="box-compartment__rows">
        <div
          v-for="(row, index) in compartment.rows"
          :key="`${compartment.id}:${index}:${row.label ?? ''}:${row.value}`"
          class="box-compartment__row"
        >
          <span v-if="row.label" class="box-compartment__label">{{ row.label }}</span>
          <code class="box-compartment__value">{{ row.value }}</code>
        </div>
      </div>
      <div v-else class="box-compartment__empty">{{ compartment.emptyText }}</div>
    </section>
  </div>
</template>

<style scoped>
.box-compartments {
  --box-compartment-header-pad-y: 6px;
  --box-compartment-header-pad-x: 10px;
  --box-compartment-row-pad-y: 7px;
  --box-compartment-row-pad-x: 10px;
  --box-compartment-header-size: 10.5px;
  --box-compartment-label-size: 11px;
  --box-compartment-value-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  background: transparent;
}

.box-compartments--dense {
  --box-compartment-header-pad-y: 6px;
  --box-compartment-header-pad-x: 9px;
  --box-compartment-row-pad-y: 6px;
  --box-compartment-row-pad-x: 9px;
  --box-compartment-header-size: 9.5px;
  --box-compartment-label-size: 10px;
  --box-compartment-value-size: 10.5px;
}

.box-compartment {
  border: 0;
  border-top: 1px solid rgb(148 163 184 / 0.45);
  border-radius: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 0;
  overflow: hidden;
  transition: flex-grow 220ms ease;
}

.box-compartment:first-child {
  border-top: 0;
}

.box-compartment--expanded {
  flex-grow: 6;
}

.box-compartment__header {
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: var(--box-compartment-header-pad-y) var(--box-compartment-header-pad-x);
  color: #0f172a;
  font-size: var(--box-compartment-header-size);
  font-weight: 600;
  flex-shrink: 0;
}

.box-compartment__header:focus-visible {
  outline: 2px solid var(--box-accent, #3b82f6);
  outline-offset: -2px;
  border-radius: 6px;
}

.box-compartment__title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.box-compartment__chevron {
  width: 0.45em;
  height: 0.45em;
  margin-right: 2px;
  border-right: 2px solid #64748b;
  border-bottom: 2px solid #64748b;
  transform: rotate(45deg);
  flex-shrink: 0;
  transition: transform 220ms ease;
}

.box-compartment--expanded .box-compartment__chevron {
  transform: rotate(225deg);
}

.box-compartment__rows {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

.box-compartment__row {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: var(--box-compartment-row-pad-y) var(--box-compartment-row-pad-x);
}

.box-compartment__row + .box-compartment__row {
  border-top: 1px solid rgb(15 23 42 / 0.06);
}

.box-compartment__label {
  color: #64748b;
  font-size: var(--box-compartment-label-size);
  font-weight: 600;
  white-space: nowrap;
}

.box-compartment__value {
  color: #0f172a;
  font-size: var(--box-compartment-value-size);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: none;
  padding: 0;
}

.box-compartment__empty {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: var(--box-compartment-row-pad-y) var(--box-compartment-row-pad-x)
    calc(var(--box-compartment-row-pad-y) + 2px);
  color: #94a3b8;
  font-size: var(--box-compartment-value-size);
  font-style: italic;
}
</style>
