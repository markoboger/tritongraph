<script setup lang="ts">
import type { PortEndpoint } from './innerArtefactGraphHelpers'

type ExternalEndpoint = { id: string; label: string; side: 'left' | 'right' }

defineProps<{
  showRootPorts: boolean
  rootPortsLeft: readonly PortEndpoint[]
  rootPortsRight: readonly PortEndpoint[]
  externalEndpoints: { left: readonly ExternalEndpoint[]; right: readonly ExternalEndpoint[] }
  bindSlotEl: (id: string, el: unknown) => void
}>()
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
    <div v-for="ep in externalEndpoints.left" :key="ep.id" class="package-box__external-endpoint">
      <div class="package-box__external-endpoint-chip">{{ ep.label }}</div>
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
    >
      <div class="package-box__external-endpoint-chip">{{ ep.label }}</div>
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
  z-index: 2;
}
.package-box__root-ports--left {
  left: 0;
}
.package-box__root-ports--right {
  right: 0;
}
.package-box__port {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border-radius: 2px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--box-accent, #64748b) 22%, #ffffff);
  border: 1.5px solid color-mix(in srgb, var(--box-accent, #64748b) 76%, #0f172a);
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.92);
  opacity: 0.94;
  z-index: 2;
}
.package-box__port--external {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.package-box__root-ports > .package-box__port--left {
  transform: translate(125%, 0);
}
.package-box__root-ports > .package-box__port--right {
  transform: translate(-125%, 0);
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
  z-index: 2;
  pointer-events: none;
}
.package-box__external-endpoints--left {
  left: 0;
  align-items: flex-end;
}
.package-box__external-endpoints--right {
  right: 0;
  align-items: flex-start;
}
.package-box__external-endpoint {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 3px;
  min-width: 0;
  pointer-events: none;
}
.package-box__external-endpoint-chip {
  max-width: 88px;
  padding: 3px 7px;
  border: 1px dashed color-mix(in srgb, var(--box-accent) 24%, rgb(148 163 184));
  border-radius: 999px;
  background: rgb(255 255 255 / 0.92);
  color: #475569;
  font-size: 10px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  z-index: 2;
  transform: translateY(-1px);
}
.package-box__external-endpoints--left .package-box__external-endpoint-chip {
  transform: translate(14px, -1px);
}
.package-box__external-endpoints--right .package-box__external-endpoint-chip {
  transform: translate(-14px, -1px);
}
.package-box__external-endpoints--left .package-box__port--external {
  transform: translate(125%, 0);
}
.package-box__external-endpoints--right .package-box__port--external {
  transform: translate(-125%, 0);
}
</style>
