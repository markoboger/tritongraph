<script setup lang="ts">
/**
 * Nested diagram container (group). The frame draws a rounded dashed rectangle and a small banner;
 * children are positioned by the depth layout. The frame participates in layer-drill animations the
 * same way leaf project boxes do — when the drill resizes a group it gets a `layerFlip` transform
 * (FLIP invert→play) so the box smoothly grows from its previous bounds to its new bounds, and the
 * inner counter-scale keeps the banner / nested boxes pixel-stable. See `applyLayerDrill` in
 * `GraphDrillIn.vue`. Without this, clicking a package container would change geometry but would
 * skip the animation, making "expand to fill the layer" feel like a discontinuous jump.
 */
import { computed, inject, ref, type Ref } from 'vue'
import folderIconUrl from '../assets/language-icons/folder.svg'
import LanguageIcon from './LanguageIcon.vue'
import { isLanguageIconId } from '../graph/languages'
import { useScalaCoverageKeyed } from '../store/useOverlay'
import type { ModuleAnchorTops } from '../graph/layoutDependencyLayers'
import DepthRelationHandles from './common/DepthRelationHandles.vue'
import BoxMetricStrip from './common/BoxMetricStrip.vue'
import { simulatedMetricsForBox } from './common/boxMetricDemo'

type LayerFlipPayload = {
  tx: number
  ty: number
  sx: number
  sy: number
  transition?: string
}

const props = defineProps<{
  id: string
  data: {
    label: string
    subtitle?: string
    layerFlip?: LayerFlipPayload
    layerDrillFocus?: boolean
    anchorTops?: ModuleAnchorTops
    /** Scala outer package scope: show folder + titles like {@link PackageBox}. */
    packageScope?: boolean
    /**
     * Detected source language for the **topmost** package scope (e.g. `scala`, `java`, `ts`).
     * Inferred upstream from `src/main/<lang>/…` path convention — see `detectLanguageFromFilePaths`
     * in `scalaPackagesToIlograph.ts`. When set, we render a language logo in the top-right corner
     * with the coverage bar placed immediately to its left. Nested sub-packages don't carry this
     * field so the logo appears only on the outermost package, matching the user's request.
     */
    language?: string
  }
}>()

/**
 * True when the language detected upstream matches one of the keys supported by {@link LanguageIcon}.
 * Guarded via {@link isLanguageIconId} so an unknown value (e.g. `"groovy"`) degrades to "no logo"
 * instead of rendering a broken icon.
 */
const hasLanguageLogo = computed(() => !!(props.data.packageScope && props.data.language && isLanguageIconId(props.data.language)))

/**
 * Outer FLIP transform: at the start of the animation the focused group sits at its `first`
 * (pre-drill) rect via this translate+scale; `playLayerFlip` then sets sx/sy back to 1 with a
 * transition to the `last` (post-drill) rect. Mirrors the same machinery on FlowProjectNode.
 */
const layerFlipStyle = computed((): Record<string, string> => {
  const f = props.data.layerFlip
  if (!f) return {}
  return {
    transform: `translate(${f.tx}px, ${f.ty}px)`,
    transformOrigin: '0 0',
    transition: f.transition ?? 'none',
  }
})

/**
 * Counter-scale the inner shell so banner text and child boxes don't squash/stretch with the
 * outer FLIP scale. Without this the banner/glyphs would wobble during the drill animation.
 */
/**
 * Real coverage percentage from Scoverage (when available).
 *
 * No placeholders: if we don't have coverage for this node, we render no bar.
 */
const workspaceKeyRef = inject<Ref<string>>('tritonWorkspaceKey', ref(''))
const scalaCoverageRef = useScalaCoverageKeyed(workspaceKeyRef, String(props.id ?? ''))
const coveragePercent = computed((): number | null => {
  const v = scalaCoverageRef.value?.stmtPct
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  return null
})
const hasCoverage = computed(() => typeof coveragePercent.value === 'number')
const coveragePercentValue = computed(() => coveragePercent.value ?? 0)
const simulatedMetrics = computed(() => simulatedMetricsForBox(props.id))

const layerFlipCounterStyle = computed((): Record<string, string> => {
  return {}
})
</script>

<template>
  <div class="group-node" :class="{ 'group-node--focus': data.layerDrillFocus }">
    <div class="group-node__flip-outer" :style="layerFlipStyle">
      <div class="group-node__flip-counter" :style="layerFlipCounterStyle">
        <div
          class="group-node__frame"
          :class="{
            'group-node__frame--package-scope': data.packageScope,
            'group-node__frame--has-language': hasLanguageLogo,
            'group-node__frame--has-metrics': true,
          }"
        >
          <div class="group-node__metrics">
            <BoxMetricStrip
              :coverage-percent="hasCoverage ? coveragePercentValue : null"
              :technical-debt-percent="simulatedMetrics.technicalDebtPercent"
              :issue-count="simulatedMetrics.issueCount"
              :issue-level="simulatedMetrics.issueLevel"
            />
          </div>
          <span
            v-if="hasLanguageLogo"
            class="group-node__language"
            :title="`Language: ${data.language}`"
            role="img"
            :aria-label="`Language ${data.language}`"
          >
            <LanguageIcon :name="(data.language as any)" />
          </span>
          <template v-if="data.packageScope">
            <div class="group-node__pkg-header">
              <img
                class="group-node__folder-icon"
                :src="folderIconUrl"
                alt=""
                aria-hidden="true"
                decoding="async"
              />
              <div class="group-node__pkg-titles">
                <div class="banner">{{ data.label }}</div>
                <div v-if="data.subtitle" class="banner-sub">{{ data.subtitle }}</div>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="banner">{{ data.label }}</div>
            <div v-if="data.subtitle" class="banner-sub">{{ data.subtitle }}</div>
          </template>
        </div>
      </div>
    </div>
    <DepthRelationHandles
      :node-id="id"
      :anchor-tops="data.anchorTops"
      target-class="gh gh-agg-in-target"
      source-class="gh gh-agg-fan-out"
    />
  </div>
</template>

<style scoped>
.group-node {
  position: relative;
  width: 100%;
  height: 100%;
}
.group-node__flip-outer {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  z-index: 0;
}
.group-node__flip-counter {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
}
.group-node__frame {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  border: 1px dashed #94a3b8;
  /* ~10% transparent over opaque fill so routing behind stays visible */
  background: rgb(248 250 252 / 0.9);
  box-sizing: border-box;
  position: relative;
}
.group-node__frame--package-scope {
  border-color: rgb(30 41 59 / 0.72);
  border-style: solid;
  border-width: 1px;
  box-shadow:
    inset 6px 0 0 0 #64748b,
    0 1px 3px rgb(15 23 42 / 0.08);
  /**
   * Package-import diagrams use the outermost package as a full-viewport group node.
   * Vue Flow paints edges below nodes, so an opaque package-scope fill would wash over
   * most relations. Keep the frame chrome, but let the body stay transparent so imports
   * remain readable through the outer scope.
   */
  background: transparent;
}
.group-node__metrics {
  position: absolute;
  top: 6px;
  right: 8px;
  width: min(124px, calc(100% - 16px));
  z-index: 5;
}
.group-node__language {
  position: absolute;
  top: 22px;
  right: 8px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  z-index: 5;
}
@container (max-width: 150px) {
  .group-node__language {
    top: 42px;
  }
}
.group-node__language :deep(.lang-svg) {
  width: 32px;
  height: 32px;
  max-width: 32px;
}
.group-node__pkg-header {
  position: absolute;
  top: 8px;
  left: 12px;
  /** Default: no coverage/language affordances → titles can use full width. */
  right: 12px;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  pointer-events: none;
}
/** Metrics strip only. */
.group-node__frame--has-metrics .group-node__pkg-header {
  right: 56px;
  padding-top: 18px;
}
@container (max-width: 150px) {
  .group-node__frame--has-metrics .group-node__pkg-header {
    padding-top: 40px;
  }
}
/** Metrics strip + language logo. */
.group-node__frame--has-language.group-node__frame--has-metrics .group-node__pkg-header {
  right: 100px;
}
.group-node__folder-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  object-fit: contain;
  opacity: 0.95;
}
.group-node__pkg-titles {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group-node--focus .group-node__frame {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.45);
}
.banner {
  position: absolute;
  top: 6px;
  left: 10px;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.banner-sub {
  position: absolute;
  top: 22px;
  left: 10px;
  font-size: 11px;
  color: #64748b;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
/**
 * Package-scope header: must come **after** `.banner` / `.banner-sub` so higher specificity wins.
 * Those rules use `position: absolute; left: 10px`, which would paint titles on top of the folder.
 */
.group-node__pkg-header .banner {
  position: static;
  top: auto;
  left: auto;
  right: auto;
  font-size: clamp(0.85rem, 1.4vmin, 1.05rem);
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.group-node__pkg-header .banner-sub {
  position: static;
  top: auto;
  left: auto;
  right: auto;
  font-size: clamp(0.72rem, 1.2vmin, 0.88rem);
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.gh {
  position: absolute;
  z-index: 12;
}
.gh-agg-in-target {
  top: 50%;
}
</style>
