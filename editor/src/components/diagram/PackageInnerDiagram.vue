<script setup lang="ts">
import { computed } from 'vue'
import type { TritonInnerArtefactSpec, TritonInnerPackageSpec } from '../../ilograph/types'
import scalaIconUrl from '../../assets/language-icons/scala.svg'
import scalaClassIconUrl from '../../assets/language-icons/scala-class.svg'
import scalaTraitIconUrl from '../../assets/language-icons/scala-trait.svg'
import scalaObjectIconUrl from '../../assets/language-icons/scala-object.svg'
import scalaEnumIconUrl from '../../assets/language-icons/scala-enum.svg'
import type { BoxMetricDemo } from '../common/boxMetricDemo'
import DiagramLeafBox from './DiagramLeafBox.vue'
import ScalaArtefactBox from './ScalaArtefactBox.vue'
import type { InnerEdgeDraw, PortEndpoint } from './innerArtefactGraphHelpers'
import InnerArtefactEdgesSvg from './InnerArtefactEdgesSvg.vue'
import InnerPackageStack from './InnerPackageStack.vue'
import InnerDiagramPorts from './InnerDiagramPorts.vue'

type ExternalEndpoint = { id: string; label: string; side: 'left' | 'right' }

const props = defineProps<{
  mode: 'focused' | 'cross-preview'
  edgeMarkerId: string
  topLevelInnerPackages: readonly TritonInnerPackageSpec[]
  innerArtefactLayerColumns: readonly string[][]
  focusedInnerArtefactId?: string | null
  innerArtefactFocusActive: boolean
  notes?: string
  normalInnerEdgeDraws: readonly InnerEdgeDraw[]
  emphasizedInnerEdgeDraws: readonly InnerEdgeDraw[]
  routedOverlayInnerEdgeDraws: readonly InnerEdgeDraw[]
  crossPackageExternalEndpoints: { left: readonly ExternalEndpoint[]; right: readonly ExternalEndpoint[] }
  childPackagePortsById: Map<string, PortEndpoint>
  rootPackagePortsLeft: readonly PortEndpoint[]
  rootPackagePortsRight: readonly PortEndpoint[]
  innerScrollX: number
  innerScrollY: number
  rootElRef: (el: unknown) => void
  colsElRef?: (el: unknown) => void
  bindSlotEl: (id: string, el: unknown) => void
  edgeEmphasized: (draw: InnerEdgeDraw) => boolean
  edgeLabelStyleFor: (draw: InnerEdgeDraw) => Record<string, string>
  artefactEmphasized: (id: string) => boolean
  artefactCell: (id: string) => TritonInnerArtefactSpec | undefined
  artefactAccent: (id: string) => string
  artefactPinned: (id: string) => boolean
  artefactHasCoverage: (id: string) => boolean
  artefactCoveragePercent: (id: string) => number
  artefactMetrics: (id: string) => BoxMetricDemo
  canOpenArtefactInEditor: (id: string) => boolean
  handleWheel: (ev: WheelEvent) => void
  handlePointerDown: (ev: PointerEvent) => void
  handleInnerCardClick: (id: string) => void
  handleArtefactRowClick: (id: string) => void
  handleFocusedArtefactBackgroundClick: (ev: MouseEvent) => void
  handleArtefactTogglePin: (id: string, ev: MouseEvent) => void
  handleArtefactCycleColor: (id: string) => void
  handleOpenArtefactInEditor: (id: string, line?: number) => void
  handleEdgeEnter: (draw: InnerEdgeDraw) => void
  handleEdgeLeave: (draw: InnerEdgeDraw) => void
  handleArtefactSlotEnter: (id: string) => void
  handleArtefactSlotLeave: (id: string) => void
}>()

const focusedArtefactId = computed(() => props.focusedInnerArtefactId ?? '')
const colsTransformStyle = computed(() =>
  props.innerScrollX || props.innerScrollY
    ? { transform: `translate(${props.innerScrollX}px,${props.innerScrollY}px)` }
    : undefined,
)

function scalaIconForKind(subtitle: string | undefined): string {
  const k = (subtitle ?? '').trim().toLowerCase()
  if (k === 'class' || k === 'case class') return scalaClassIconUrl
  if (k === 'object' || k === 'case object') return scalaObjectIconUrl
  if (k === 'trait') return scalaTraitIconUrl
  if (k === 'enum') return scalaEnumIconUrl
  return scalaIconUrl
}
</script>

<template>
  <div
    :ref="rootElRef"
    class="package-box__inner-artefact-diagram"
    :class="{
      'package-box__inner-artefact-diagram--artefact-focus': innerArtefactFocusActive,
      'package-box__inner-artefact-diagram--cross-preview': mode === 'cross-preview',
    }"
    @wheel.prevent.stop="mode === 'focused' ? handleWheel($event) : undefined"
    @pointerdown="mode === 'focused' ? handlePointerDown($event) : undefined"
  >
    <InnerArtefactEdgesSvg
      :edge-marker-id="edgeMarkerId"
      :draws="normalInnerEdgeDraws"
      :edge-emphasized="edgeEmphasized"
      :edge-label-style-for="edgeLabelStyleFor"
      :on-edge-enter="handleEdgeEnter"
      :on-edge-leave="handleEdgeLeave"
    />

    <div
      :ref="colsElRef"
      class="package-box__inner-artefact-cols"
      :class="{
        'package-box__inner-artefact-cols--artefact-focus': innerArtefactFocusActive,
        'package-box__inner-artefact-cols--with-packages': mode === 'focused' && topLevelInnerPackages.length > 0,
      }"
      :style="mode === 'focused' ? colsTransformStyle : undefined"
    >
      <InnerPackageStack
        v-if="mode === 'focused'"
        :packages="topLevelInnerPackages"
        :child-package-ports-by-id="childPackagePortsById"
        :bind-slot-el="bindSlotEl"
        :on-inner-card-click="handleInnerCardClick"
      />

      <InnerDiagramPorts
        :show-root-ports="mode === 'focused'"
        :root-ports-left="rootPackagePortsLeft"
        :root-ports-right="rootPackagePortsRight"
        :external-endpoints="crossPackageExternalEndpoints"
        :bind-slot-el="bindSlotEl"
      />

      <div
        v-for="(col, ci) in innerArtefactLayerColumns"
        :key="'col-' + ci"
        class="package-box__inner-artefact-col"
        :class="{
          'package-box__inner-artefact-col--focus': innerArtefactFocusActive && col.includes(focusedArtefactId),
          'package-box__inner-artefact-col--peer': innerArtefactFocusActive && !col.includes(focusedArtefactId),
        }"
      >
        <template v-for="artId in col" :key="artId">
          <div
            v-if="mode === 'focused' && innerArtefactFocusActive && focusedArtefactId === artId && artefactCell(artId)"
            :ref="(el) => bindSlotEl(artId, el)"
            class="package-box__inner-slot package-box__inner-slot--artefact-layer package-box__inner-slot--artefact-focused-cell"
            :style="{ '--box-accent': artefactAccent(artId) }"
            @click="handleFocusedArtefactBackgroundClick"
          >
            <span class="package-box__artefact-anchor package-box__artefact-anchor--in" :class="{ 'package-box__artefact-anchor--emph': artefactEmphasized(artId) }" aria-hidden="true" />
            <span class="package-box__artefact-anchor package-box__artefact-anchor--out" :class="{ 'package-box__artefact-anchor--emph': artefactEmphasized(artId) }" aria-hidden="true" />
            <ScalaArtefactBox
              :box-id="artId"
              :label="artefactCell(artId)!.name"
              :subtitle="artefactCell(artId)!.subtitle ?? ''"
              :declaration="artefactCell(artId)!.declaration"
              :constructor-params="artefactCell(artId)!.constructorParams"
              :method-signatures="artefactCell(artId)!.methodSignatures"
              :notes="notes"
              :box-color="artefactAccent(artId)"
              :pinned="artefactPinned(artId)"
              :show-pin-tool="true"
              :show-color-tool="true"
              :can-open-in-editor="canOpenArtefactInEditor(artId)"
              class="package-box__inner-artefact-focus-card"
              @toggle-pin="(ev: MouseEvent) => handleArtefactTogglePin(artId, ev)"
              @cycle-color="handleArtefactCycleColor(artId)"
              @open-in-editor="(line?: number) => handleOpenArtefactInEditor(artId, line)"
            />
          </div>
          <template
            v-else-if="
              mode === 'focused'
                && innerArtefactFocusActive
                && col.includes(focusedArtefactId)
                && focusedArtefactId !== artId
            "
          />
          <div
            v-else-if="artefactCell(artId)"
            :ref="(el) => bindSlotEl(artId, el)"
            class="package-box__inner-slot package-box__inner-slot--artefact package-box__inner-slot--artefact-layer"
            :class="{
              'package-box__inner-slot--clickable': mode === 'focused',
              'package-box__inner-slot--inner-hovered': mode === 'focused' && artefactEmphasized(artId),
            }"
            :style="{ '--box-accent': artefactAccent(artId) }"
            @mouseenter="mode === 'focused' ? handleArtefactSlotEnter(artId) : undefined"
            @mouseleave="mode === 'focused' ? handleArtefactSlotLeave(artId) : undefined"
            @click.stop="mode === 'focused' ? handleArtefactRowClick(artId) : undefined"
          >
            <DiagramLeafBox
              class="package-box__artefact-row"
              :label="artefactCell(artId)!.name"
              :subtitle="artefactCell(artId)!.subtitle ?? ''"
              :icon-url="scalaIconForKind(artefactCell(artId)!.subtitle)"
              :icon-alt="artefactCell(artId)!.subtitle ?? ''"
              :accent="artefactAccent(artId)"
              :coverage-percent="mode === 'focused' && artefactHasCoverage(artId) ? artefactCoveragePercent(artId) : null"
              :technical-debt-percent="mode === 'focused' ? artefactMetrics(artId).technicalDebtPercent : null"
              :issue-count="mode === 'focused' ? artefactMetrics(artId).issueCount : null"
              :issue-level="mode === 'focused' ? artefactMetrics(artId).issueLevel : null"
            >
              <template #overlay>
                <span class="package-box__artefact-anchor package-box__artefact-anchor--in" :class="{ 'package-box__artefact-anchor--emph': mode === 'focused' && artefactEmphasized(artId) }" aria-hidden="true" />
                <span class="package-box__artefact-anchor package-box__artefact-anchor--out" :class="{ 'package-box__artefact-anchor--emph': mode === 'focused' && artefactEmphasized(artId) }" aria-hidden="true" />
              </template>
            </DiagramLeafBox>
          </div>
        </template>
      </div>

    </div>

    <slot name="scroll-rails" />

    <InnerArtefactEdgesSvg
      v-if="mode === 'focused'"
      overlay
      :edge-marker-id="edgeMarkerId"
      :draws="emphasizedInnerEdgeDraws"
      :bridge-draws="routedOverlayInnerEdgeDraws"
      :edge-emphasized="edgeEmphasized"
      :edge-label-style-for="edgeLabelStyleFor"
      :on-edge-enter="handleEdgeEnter"
      :on-edge-leave="handleEdgeLeave"
    />
  </div>
</template>

<style scoped>
.package-box__inner-artefact-diagram {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: hidden;
  transition:
    flex 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    min-height 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.package-box__inner-artefact-diagram--cross-preview {
  margin-top: 8px;
}
.package-box__inner-artefact-diagram--artefact-focus {
  flex: 1 1 0;
  min-height: 0;
}
.package-box__inner-artefact-focus-card {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  align-self: stretch;
}
.package-box__inner-artefact-cols {
  --triton-inner-artefact-min-h: 40px;
  --triton-inner-artefact-preferred-h: 132px;
  position: relative;
  z-index: 0;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: flex-start;
  justify-content: center;
  gap: clamp(18px, 5.5cqw, 36px);
  flex: 0 0 auto;
  min-height: min-content;
  min-width: 0;
  padding: 4px 6px 10px;
  overflow: visible;
  transition:
    flex 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    min-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    gap 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.package-box__inner-artefact-cols--artefact-focus {
  flex: 1 1 0;
  min-height: 0;
  align-items: stretch;
  gap: clamp(32px, 7cqw, 64px);
}
.package-box__inner-artefact-cols--with-packages {
  flex: 1 1 0;
  min-height: 0;
  align-items: stretch;
  justify-content: flex-start;
}
.package-box__inner-artefact-col {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
  flex: 1 1 0;
  min-width: 0;
  min-height: min-content;
  max-width: min(100%, 220px);
  overflow: visible;
  transition:
    flex 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    max-width 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    min-width 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.package-box__inner-artefact-cols--artefact-focus > .package-box__inner-artefact-col {
  min-height: 0;
}
.package-box__inner-artefact-col--focus {
  flex: 2.6 1 0;
  max-width: none;
  min-width: 0;
}
.package-box__inner-artefact-col--peer {
  flex: 0 1 auto;
  max-width: clamp(56px, 9cqw, 84px);
  min-width: 48px;
}
.package-box__inner-slot {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: visible;
}
.package-box__inner-slot > :deep(.package-box) {
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
.package-box__inner-slot.package-box__inner-slot--artefact-layer {
  flex: 0 0 var(--triton-inner-artefact-preferred-h);
  min-height: var(--triton-inner-artefact-min-h);
  align-self: stretch;
}
.package-box__inner-slot.package-box__inner-slot--artefact-layer .package-box__artefact-row {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
}
.package-box__inner-slot--artefact-layer.package-box__inner-slot--artefact-focused-cell {
  flex: 1 1 0;
  min-height: 0;
  align-self: stretch;
  cursor: pointer;
}
.package-box__artefact-anchor {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-sizing: border-box;
  background: var(--box-accent, #64748b);
  border: 1.5px solid color-mix(in srgb, var(--box-accent, #64748b) 72%, #0f172a);
  z-index: 2;
  pointer-events: none;
  opacity: 0.88;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    opacity 0.15s ease;
}
.package-box__artefact-anchor--in {
  left: -5px;
}
.package-box__artefact-anchor--out {
  right: -5px;
}
.package-box__artefact-anchor--emph {
  opacity: 1;
  box-shadow: 0 0 0 2px rgb(255 255 255 / 0.95);
}
.package-box__inner-slot--inner-hovered .package-box__artefact-row {
  border-color: var(--box-accent, #64748b);
  box-shadow:
    inset 5px 0 0 0 var(--box-accent, steelblue),
    0 0 0 1px rgb(255 255 255 / 0.85),
    0 0 0 2px var(--box-accent, #64748b),
    0 2px 8px rgb(15 23 42 / 0.08);
}
</style>
