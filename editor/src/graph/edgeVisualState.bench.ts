/**
 * Benchmark: signature-based change detection vs boolean-flag approach in syncEdgeVisualState.
 *
 * Context: syncEdgeVisualState (GraphWorkspace.vue) maps all edges, returning the same reference
 * for unchanged edges (per-edge check) and a new object for changed ones.  It then calls
 * edgeVisualSignature() on both the old and new arrays to decide whether to write edges.value.
 *
 * edgeVisualSignature concatenates "id:hidden:class" for every edge → O(n) string allocation
 * done TWICE per call, on every hover/visibility event, for all 500+ edges even when only
 * 1–2 edges actually changed.
 *
 * The fix: track `changed` during the map itself.  If nothing changed all items in `next`
 * are the same object references as in `edges.value` — we can skip edges.value = next entirely
 * without ever building the signature strings.
 *
 * This bench measures the savings in the "nothing changed" and "one edge changed" hot paths.
 *
 * Run baseline:  npx vitest bench --outputJson bench-baseline.json
 * Run after fix: npx vitest bench --compare bench-baseline.json --outputJson bench-after.json
 */
import { bench, describe } from 'vitest'

// ---------------------------------------------------------------------------
// Synthetic edge shape (matches what syncEdgeVisualState reads)
// ---------------------------------------------------------------------------

interface FakeEdge {
  id: string
  source: string
  target: string
  hidden: boolean
  class: string | undefined
  zIndex: number
  labelStyle: { fill: string; opacity: number; fontWeight: string; fontSize: string; transform: string }
  label: string
  data: { type: string }
}

function makeEdge(i: number): FakeEdge {
  return {
    id: `e${i}`,
    source: `n${i % 50}`,
    target: `n${(i + 1) % 50}`,
    hidden: false,
    class: undefined,
    zIndex: 0,
    labelStyle: { fill: '#94a3b8', opacity: 0.7, fontWeight: '400', fontSize: '11px', transform: '' },
    label: 'depends on',
    data: { type: 'depends_on' },
  }
}

function buildEdges(n: number): FakeEdge[] {
  return Array.from({ length: n }, (_, i) => makeEdge(i))
}

// ---------------------------------------------------------------------------
// Replicas of the two approaches (no Vue dependencies)
// ---------------------------------------------------------------------------

/** Current approach: serialize both arrays and compare strings. */
function edgeVisualSignature(arr: FakeEdge[]): string {
  return arr.map((e) => `${e.id}:${e.hidden ? 1 : 0}:${e.class ?? ''}`).join('\n')
}

/**
 * Simulate a full syncEdgeVisualState pass using the CURRENT (baseline) approach.
 * hoveredNodeId: which node is hovered ('' = none).
 */
function syncEdges_baseline(
  edges: FakeEdge[],
  hoveredNodeId: string,
): FakeEdge[] | null {
  const next = edges.map((e) => {
    const emph = !!(hoveredNodeId && (e.source === hoveredNodeId || e.target === hoveredNodeId))
    const newHidden = false
    const newClass = emph ? 'edge-emph' : undefined
    const newZIndex = emph ? 1200 : 0
    const newLabelStyle = emph
      ? { fill: '#3b82f6', opacity: 1, fontWeight: '600', fontSize: '11px', transform: '' }
      : { fill: '#94a3b8', opacity: 0.7, fontWeight: '400', fontSize: '11px', transform: '' }

    const prevH = e.hidden
    const prevC = e.class
    const prevZ = e.zIndex
    const prevLS = e.labelStyle
    const sameLabelStyle =
      prevLS.fill === newLabelStyle.fill &&
      prevLS.opacity === newLabelStyle.opacity &&
      prevLS.fontWeight === newLabelStyle.fontWeight
    if (newClass === prevC && newHidden === prevH && prevZ === newZIndex && sameLabelStyle) return e
    return { ...e, class: newClass, hidden: newHidden, zIndex: newZIndex, labelStyle: newLabelStyle }
  })
  // CURRENT: serialize both arrays to detect if anything changed
  if (edgeVisualSignature(next) === edgeVisualSignature(edges)) return null
  return next
}

/**
 * Simulate a full syncEdgeVisualState pass using the FIXED (after) approach.
 * Tracks `changed` during the map — no string serialization needed.
 */
function syncEdges_fixed(
  edges: FakeEdge[],
  hoveredNodeId: string,
): FakeEdge[] | null {
  let changed = false
  const next = edges.map((e) => {
    const emph = !!(hoveredNodeId && (e.source === hoveredNodeId || e.target === hoveredNodeId))
    const newHidden = false
    const newClass = emph ? 'edge-emph' : undefined
    const newZIndex = emph ? 1200 : 0
    const newLabelStyle = emph
      ? { fill: '#3b82f6', opacity: 1, fontWeight: '600', fontSize: '11px', transform: '' }
      : { fill: '#94a3b8', opacity: 0.7, fontWeight: '400', fontSize: '11px', transform: '' }

    const prevH = e.hidden
    const prevC = e.class
    const prevZ = e.zIndex
    const prevLS = e.labelStyle
    const sameLabelStyle =
      prevLS.fill === newLabelStyle.fill &&
      prevLS.opacity === newLabelStyle.opacity &&
      prevLS.fontWeight === newLabelStyle.fontWeight
    if (newClass === prevC && newHidden === prevH && prevZ === newZIndex && sameLabelStyle) return e
    changed = true
    return { ...e, class: newClass, hidden: newHidden, zIndex: newZIndex, labelStyle: newLabelStyle }
  })
  // FIXED: no signature call — changed flag was set during map
  if (!changed) return null
  return next
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('syncEdgeVisualState — nothing changed (hover = none)', () => {
  // Hot path: mouse moves over blank canvas, no node/edge hovered, nothing changes.
  // ALL edges return the same reference → next === edges item-for-item.
  // Baseline still builds two signature strings; fixed returns immediately.

  const e100 = buildEdges(100)
  bench('baseline  100 edges, no change', () => { syncEdges_baseline(e100, '') })
  bench('fixed     100 edges, no change', () => { syncEdges_fixed(e100, '') })

  const e300 = buildEdges(300)
  bench('baseline  300 edges, no change', () => { syncEdges_baseline(e300, '') })
  bench('fixed     300 edges, no change', () => { syncEdges_fixed(e300, '') })

  const e600 = buildEdges(600)
  bench('baseline  600 edges, no change', () => { syncEdges_baseline(e600, '') })
  bench('fixed     600 edges, no change', () => { syncEdges_fixed(e600, '') })
})

describe('syncEdgeVisualState — 2 edges change (node hover)', () => {
  // Common path: user hovers a node that has 2 incident edges.
  // 2 edges get new objects; baseline still serializes all N edges twice.

  const e100b = buildEdges(100)
  bench('baseline  100 edges, 2 change', () => { syncEdges_baseline(e100b, 'n0') })
  bench('fixed     100 edges, 2 change', () => { syncEdges_fixed(e100b, 'n0') })

  const e300b = buildEdges(300)
  bench('baseline  300 edges, 2 change', () => { syncEdges_baseline(e300b, 'n0') })
  bench('fixed     300 edges, 2 change', () => { syncEdges_fixed(e300b, 'n0') })

  const e600b = buildEdges(600)
  bench('baseline  600 edges, 2 change', () => { syncEdges_baseline(e600b, 'n0') })
  bench('fixed     600 edges, 2 change', () => { syncEdges_fixed(e600b, 'n0') })
})
