/**
 * Handle ids for compile-dependency edges (`source` = dependent, `target` = dependency).
 *
 * Dependency columns are **LR**: dependent **left**, classpath dependency **right**; edges run **rightward**.
 * **source** (consumer) uses the **right** face toward the dependency; **target** uses the **left** face.
 */
export const DEP_SOURCE_HANDLE = 'dep-out'

export const DEP_TARGET_HANDLE = 'dep-in'

/**
 * sbt `aggregate(from → to)`: aggregator is **left** of deeper modules in the depth layout.
 * Edge runs **rightward** (parent → child): **source** on the **right** face of the aggregator,
 * **target** on the **left** face of the aggregated project. (Opposite of `depends on` / classpath.)
 *
 * Parallel depth relations use slotted source/target handles so Vue Flow attaches each edge to a
 * distinct anchor point on both endpoints (smoothstep offset alone does not separate them).
 */
export const AGG_FAN_SOURCE_COUNT = 8
export const AGG_FAN_TARGET_COUNT = 8

function clampSlot(slot: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(slot)))
}

export function aggregateSourceHandleId(slot: number): string {
  const s = clampSlot(slot, AGG_FAN_SOURCE_COUNT)
  return `agg-out-${s}`
}

export function aggregateTargetHandleId(slot: number): string {
  const s = clampSlot(slot, AGG_FAN_TARGET_COUNT)
  return `agg-in-${s}`
}

/** Spread only **used** aggregate-out slots across the same vertical band (avoids empty gaps). */
export function aggregateFanTopPctForUsedSlots(slot: number, usedSorted: readonly number[]): number {
  if (!usedSorted.length) return 50
  const idx = usedSorted.indexOf(slot)
  if (idx < 0) return 50
  const n = usedSorted.length
  if (n === 1) return 50
  const min = 18
  const span = 64
  return min + (idx / (n - 1)) * span
}

/** Default aggregate-out handle (first fan slot). */
export const AGG_SOURCE_HANDLE = aggregateSourceHandleId(0)

/** Default aggregate-in handle (first fan slot). */
export const AGG_TARGET_HANDLE = aggregateTargetHandleId(0)
