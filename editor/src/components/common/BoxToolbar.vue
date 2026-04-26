<script setup lang="ts">
defineProps<{
  accent: string
  pinned: boolean
  showPinTool: boolean
  showColorTool: boolean
  pinTitle: string
  pinAriaLabel: string
}>()

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
}>()
</script>

<template>
  <div
    v-if="showPinTool || showColorTool"
    class="box-toolbar"
    :style="{ '--box-accent': accent }"
    @pointerdown.stop
  >
    <button
      v-if="showPinTool"
      type="button"
      class="tool-btn tool-btn--pin"
      :class="{ 'tool-btn--active': pinned }"
      :title="pinTitle"
      :aria-pressed="pinned ? 'true' : 'false'"
      :aria-label="pinAriaLabel"
      @click.stop="emit('toggle-pin', $event)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" class="tool-btn__icon tool-btn__icon--pin">
        <path
          fill="currentColor"
          d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"
        />
      </svg>
    </button>
    <button
      v-if="showColorTool"
      type="button"
      class="tool-btn tool-btn--color"
      :title="`Accent: ${accent}. Click for next color.`"
      aria-label="Change box accent color"
      @click.stop="emit('cycle-color')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" class="tool-btn__icon tool-btn__icon--color">
        <circle cx="6" cy="8" r="4.25" />
        <circle cx="11" cy="8" r="3" opacity="0.45" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.box-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 5px;
  max-width: calc(100% - 2px);
}

.tool-btn {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid rgb(15 23 42 / 0.22);
  background: rgb(255 255 255 / 0.92);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  color: rgb(51 65 85);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease, color 0.2s ease;
}

.tool-btn:hover {
  border-color: var(--box-accent);
  background: rgb(255 255 255 / 1);
  transform: scale(1.06);
}

.tool-btn:active {
  transform: scale(0.96);
}

.tool-btn--active {
  border-color: var(--box-accent);
  color: var(--box-accent);
  background: rgb(255 255 255 / 1);
}

.tool-btn__icon {
  width: 14px;
  height: 14px;
  display: block;
}

.tool-btn__icon--color {
  fill: var(--box-accent);
}

.tool-btn__icon--pin {
  fill: currentColor;
}
</style>
