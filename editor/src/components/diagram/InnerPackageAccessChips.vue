<script setup lang="ts">
/**
 * "Accessed from" chips on a fixed inner-package tile: which sibling boxes import into it, i.e. where
 * the outside enters this box. In the git-diff overlay a chip turns green when that access is new.
 */
import { inject } from 'vue'
import { gitDiffKey } from '../../graph/gitDiffOverlay'

const props = defineProps<{
  tileId: string
  accessedFrom: readonly string[]
}>()

const gitDiff = inject(gitDiffKey, null)

/** Box ids are module paths; the chip shows the last segment (`depot.orders` → `orders`). */
function shortName(boxId: string): string {
  return boxId.split(/[./]/).pop() || boxId
}

function isNew(boxId: string): boolean {
  return !!gitDiff?.visible.value && !!gitDiff.isNewImportInto?.(boxId, props.tileId)
}
</script>

<template>
  <ul class="inner-access-chips" aria-label="Imported from outside by">
    <li
      v-for="boxId in accessedFrom"
      :key="boxId"
      class="inner-access-chips__chip"
      :class="{ 'inner-access-chips__chip--new': isNew(boxId) }"
      :title="`${boxId} imports into this package${isNew(boxId) ? ' (new since the diff base)' : ''}`"
    >
      ← {{ shortName(boxId) }}
    </li>
  </ul>
</template>

<style scoped>
.inner-access-chips {
  /* The embedded box's slot is a stretching flex row: keep the chips at their natural size. */
  align-self: flex-end;
  align-items: flex-start;
  align-content: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.inner-access-chips__chip {
  padding: 1px 7px;
  border: 1px solid #93c5fd;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}
.inner-access-chips__chip--new {
  border-color: #16a34a;
  background: #f0fdf4;
  color: #15803d;
}
</style>
