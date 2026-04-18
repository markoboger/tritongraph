/**
 * Handle ids for compile-dependency edges (`source` = dependent, `target` = dependency).
 *
 * Layout uses Dagre **RL**: dependency sits **left**, consumers **right**, so edges run **leftward**.
 * Then the **source** (consumer) port must face the dependency → **left** side of the box.
 * The **target** (shared module) must accept from the right → **right** side of the box.
 *
 * (If you ever switch to LR with consumers left of a dependency, swap these positions in the node components.)
 */
export const DEP_SOURCE_HANDLE = 'dep-out'

export const DEP_TARGET_HANDLE = 'dep-in'

/**
 * sbt `aggregate(from → to)`: aggregator is **left** of deeper modules in the depth layout.
 * Edge runs **rightward** (parent → child): **source** on the **right** face of the aggregator,
 * **target** on the **left** face of the aggregated project. (Opposite of `depends on` / classpath.)
 */
export const AGG_SOURCE_HANDLE = 'agg-out'

export const AGG_TARGET_HANDLE = 'agg-in'
