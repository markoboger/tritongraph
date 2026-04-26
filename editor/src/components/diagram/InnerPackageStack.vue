<script setup lang="ts">
import type { TritonInnerPackageSpec } from '../../ilograph/types'
import PackageBox from './PackageBox.vue'
import { childPackagePortId, type PortEndpoint } from './innerArtefactGraphHelpers'

defineProps<{
  packages: readonly TritonInnerPackageSpec[]
  childPackagePortsById: Map<string, PortEndpoint>
  bindSlotEl: (id: string, el: unknown) => void
  onInnerCardClick: (id: string) => void
}>()
</script>

<template>
  <div v-if="packages.length" class="package-box__inner-package-stack">
    <div v-for="child in packages" :key="child.id" class="package-box__inner-package-row">
      <div
        v-if="childPackagePortsById.get(childPackagePortId(child.id, 'left'))"
        class="package-box__inner-package-port-anchor package-box__inner-package-port-anchor--left"
        aria-hidden="true"
      >
        <div
          :ref="(el) => bindSlotEl(childPackagePortId(child.id, 'left'), el)"
          class="package-box__port package-box__port--left"
        />
      </div>
      <div
        :ref="(el) => bindSlotEl(child.id, el)"
        class="package-box__inner-slot package-box__inner-slot--clickable package-box__inner-slot--inner-package"
        @click.stop="onInnerCardClick(child.id)"
      >
        <PackageBox
          embedded
          :box-id="child.id"
          :label="child.name"
          :subtitle="child.subtitle ?? ''"
          :focused="false"
          :pinned="false"
          :show-pin-tool="false"
          :show-color-tool="false"
        />
      </div>
      <div
        v-if="childPackagePortsById.get(childPackagePortId(child.id, 'right'))"
        class="package-box__inner-package-port-anchor package-box__inner-package-port-anchor--right"
        aria-hidden="true"
      >
        <div
          :ref="(el) => bindSlotEl(childPackagePortId(child.id, 'right'), el)"
          class="package-box__port package-box__port--right"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.package-box__inner-package-stack {
  flex: 0 0 clamp(156px, 22cqw, 232px);
  min-width: 0;
  min-height: 0;
  height: 100%;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
  gap: 10px;
  overflow: visible;
}
.package-box__inner-package-row {
  position: relative;
  flex: 1 1 0;
  min-height: clamp(132px, 24cqh, 240px);
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 0;
  overflow: visible;
}
.package-box__inner-package-port-anchor {
  position: absolute;
  top: 50%;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 2;
}
.package-box__inner-package-port-anchor--left {
  left: 0;
}
.package-box__inner-package-port-anchor--right {
  right: 0;
}
.package-box__inner-slot--inner-package {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  height: 100%;
  overflow: visible;
}
.package-box__inner-slot--inner-package > :deep(.package-box) {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  align-self: stretch;
}
.package-box__inner-slot--clickable {
  cursor: pointer;
}
.package-box__port {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border-radius: 2px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--box-accent, #64748b) 42%, #ffffff);
  border: 2px solid color-mix(in srgb, var(--box-accent, #64748b) 82%, #0f172a);
  box-shadow:
    0 0 0 2px rgb(255 255 255 / 0.96),
    0 1px 4px rgb(15 23 42 / 0.18);
  opacity: 1;
  z-index: 2;
}
.package-box__inner-package-port-anchor > .package-box__port--left {
  transform: translate(-50%, -50%);
}
.package-box__inner-package-port-anchor > .package-box__port--right {
  transform: translate(-50%, -50%);
}
</style>
