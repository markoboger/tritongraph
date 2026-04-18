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
 */
export const AGG_SOURCE_HANDLE = 'agg-out'

export const AGG_TARGET_HANDLE = 'agg-in'
