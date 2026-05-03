<script setup lang="ts">
import type { PortEndpoint } from './innerArtefactGraphHelpers'

type ExternalEndpoint = { id: string; label: string; side: 'left' | 'right'; foreignPackageId: string }

defineProps<{
  showRootPorts: boolean
  rootPortsLeft: readonly PortEndpoint[]
  rootPortsRight: readonly PortEndpoint[]
  externalEndpoints: { left: readonly ExternalEndpoint[]; right: readonly ExternalEndpoint[] }
  bindSlotEl: (id: string, el: unknown) => void
}>()

const emit = defineEmits<{
  /** True while pointer is over a cross-package endpoint chip (parent lifts `inner-port-layer` z-index). */
  endpointChipHover: [hovered: boolean]
}>()

function onEndpointChipEnter() {
  emit('endpointChipHover', true)
}

function onEndpointChipLeave(ev: MouseEvent) {
  const rel = ev.relatedTarget as HTMLElement | null
  if (rel?.closest('.package-box__external-endpoint-chip')) return
  emit('endpointChipHover', false)
}
</script>

<template>
  <div v-if="showRootPorts && rootPortsLeft.length" class="package-box__root-ports package-box__root-ports--left">
    <div
      v-for="port in rootPortsLeft"
      :key="port.id"
      :ref="(el) => bindSlotEl(port.id, el)"
      class="package-box__port package-box__port--left"
      aria-hidden="true"
    />
  </div>

  <div v-if="externalEndpoints.left.length" class="package-box__external-endpoints package-box__external-endpoints--left">
    <div
      v-for="ep in externalEndpoints.left"
      :key="ep.id"
      class="package-box__external-endpoint"
      :data-triton-foreign-package-id="ep.foreignPackageId"
    >
      <div
        class="package-box__external-endpoint-chip"
        @mouseenter="onEndpointChipEnter"
        @mouseleave="onEndpointChipLeave"
      >
        {{ ep.label }}
      </div>
      <span
        :ref="(el) => bindSlotEl(ep.id, el)"
        class="package-box__port package-box__port--external package-box__port--right"
        aria-hidden="true"
      />
    </div>
  </div>

  <div v-if="showRootPorts && rootPortsRight.length" class="package-box__root-ports package-box__root-ports--right">
    <div
      v-for="port in rootPortsRight"
      :key="port.id"
      :ref="(el) => bindSlotEl(port.id, el)"
      class="package-box__port package-box__port--right"
      aria-hidden="true"
    />
  </div>

  <div v-if="externalEndpoints.right.length" class="package-box__external-endpoints package-box__external-endpoints--right">
    <div
      v-for="ep in externalEndpoints.right"
      :key="ep.id"
      class="package-box__external-endpoint package-box__external-endpoint--right"
      :data-triton-foreign-package-id="ep.foreignPackageId"
    >
      <div
        class="package-box__external-endpoint-chip"
        @mouseenter="onEndpointChipEnter"
        @mouseleave="onEndpointChipLeave"
      >
        {{ ep.label }}
      </div>
      <span
        :ref="(el) => bindSlotEl(ep.id, el)"
        class="package-box__port package-box__port--external package-box__port--left"
        aria-hidden="true"
      />
    </div>
  </div>
</template>

<style scoped>
.package-box__root-ports {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  overflow: visible;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  pointer-events: none;
  /** Above external chips so root package ports stay easy to target for edges. */
  z-index: 2;
}
.package-box__root-ports--left {
  left: 0;
}
.package-box__root-ports--right {
  right: 0;
}
.package-box__port {
  --triton-inner-port-size: 14px;
  width: var(--triton-inner-port-size);
  height: var(--triton-inner-port-size);
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
.package-box__port--external {
  --triton-inner-port-size: 16px;
  flex-shrink: 0;
}
.package-box__root-ports > .package-box__port--left {
  transform: none;
}
.package-box__root-ports > .package-box__port--right {
  transform: none;
}
.package-box__external-endpoints {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  overflow: visible;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  min-width: 0;
  z-index: 0;
  pointer-events: none;
}
.package-box__external-endpoints--left {
  left: 0;
  align-items: flex-start;
}
.package-box__external-endpoints--right {
  right: 0;
  align-items: flex-end;
}
.package-box__external-endpoint {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  pointer-events: none;
}
.package-box__external-endpoint:has(.package-box__external-endpoint-chip:hover) {
  z-index: 80;
}
.package-box__external-endpoints--left .package-box__external-endpoint {
  flex-direction: row-reverse;
}
.package-box__external-endpoints--right .package-box__external-endpoint {
  flex-direction: row;
}
.package-box__external-endpoint-chip {
  max-width: 132px;
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--box-accent, #64748b) 36%, rgb(148 163 184));
  border-radius: 999px;
  background: color-mix(in srgb, var(--box-accent, #64748b) 10%, #ffffff);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.96),
    0 2px 7px rgb(15 23 42 / 0.13);
  color: #334155;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  z-index: 0;
  transform: none;
  pointer-events: auto;
  transition:
    max-width 0.12s ease,
    box-shadow 0.12s ease,
    z-index 0s;
}
.package-box__external-endpoint-chip:hover {
  max-width: min(360px, 70vw);
  overflow: visible;
  z-index: 5;
  background: color-mix(in srgb, var(--box-accent, #64748b) 16%, #ffffff);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.98),
    0 8px 22px rgb(15 23 42 / 0.22);
}
.package-box__external-endpoints--left .package-box__external-endpoint-chip {
  transform: translateX(8px);
}
.package-box__external-endpoints--right .package-box__external-endpoint-chip {
  transform: translateX(-8px);
}
.package-box__external-endpoints--left .package-box__port--external {
  transform: translateX(-50%);
}
.package-box__external-endpoints--right .package-box__port--external {
  transform: translateX(50%);
}
</style>
