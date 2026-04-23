/**
 * Benchmark: applyLayerDrill traversal patterns before and after fix #7.
 *
 * What fix #7 changed in applyLayerDrill:
 *   BASELINE — isModulePinnedIn(nodes, id) called per participant in two loops
 *              + two filter() + one some() over regionParticipants.
 *              Each isModulePinnedIn does nodes.find() → O(n) per call → O(n×k) total.
 *   FIXED    — pinnedIds Set built once (O(n)), then two loops over participants only (O(k)).
 *              wideAtFocusDepthIds and layoutParticipants built in the same pass.
 *
 * Scenarios mirror real diagram sizes:
 *   flat-N   — N nodes, ~N/3 region participants, no pinned nodes
 *   pinned-N — same but 10% of participants are pinned
 */
import { bench, describe } from 'vitest'

// ---------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------

interface FakeNode { id: string; parentNode?: string; data: { pinned?: boolean } }
interface Participant { id: string; depth: number }

function makeNodes(n: number, pinnedFraction = 0): FakeNode[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    data: pinnedFraction > 0 && i % Math.round(1 / pinnedFraction) === 0 ? { pinned: true } : {},
  }))
}

function makeParticipants(nodes: FakeNode[], numCols: number): Participant[] {
  return nodes
    .filter((_, i) => i % 3 !== 2)           // ~2/3 of nodes are region participants
    .map((n, i) => ({ id: n.id, depth: i % numCols }))
}

// ---------------------------------------------------------------------------
// Baseline implementations
// ---------------------------------------------------------------------------

function isModulePinnedIn_baseline(nodes: FakeNode[], id: string): boolean {
  const n = nodes.find((x) => x.id === id)
  return n?.data?.pinned === true
}

function drillTraversals_baseline(nodes: FakeNode[], participants: Participant[], focusDepth: number, focusId: string) {
  // Pass 1: depthsWithPinned — one nodes.find() per participant
  const depthsWithPinned = new Set<number>()
  for (const m of participants) {
    if (isModulePinnedIn_baseline(nodes, m.id)) depthsWithPinned.add(m.depth)
  }

  // Pass 2: hiddenSiblingIds — two more nodes.find() per participant
  const hiddenSiblingIds = new Set<string>()
  for (const m of participants) {
    if (m.id === focusId) continue
    if (m.depth === focusDepth && !isModulePinnedIn_baseline(nodes, m.id)) hiddenSiblingIds.add(m.id)
    if (depthsWithPinned.has(m.depth) && !isModulePinnedIn_baseline(nodes, m.id)) hiddenSiblingIds.add(m.id)
  }

  // some() scan
  const anyHidden = participants.some((m) => hiddenSiblingIds.has(m.id))

  // wideAtFocusDepthIds — another filter + nodes.find() per item
  const wideAtFocusDepthIds = new Set(
    participants
      .filter((m) => m.depth === focusDepth && isModulePinnedIn_baseline(nodes, m.id))
      .map((m) => m.id),
  )

  // layoutParticipants — another filter
  const layoutParticipants = participants.filter((m) => !hiddenSiblingIds.has(m.id))

  return { hiddenSiblingIds, anyHidden, wideAtFocusDepthIds, layoutParticipants }
}

// ---------------------------------------------------------------------------
// Fixed implementations
// ---------------------------------------------------------------------------

function drillTraversals_fixed(nodes: FakeNode[], participants: Participant[], focusDepth: number, focusId: string) {
  // Build pinnedIds once — O(n)
  const pinnedIds = new Set<string>()
  for (const n of nodes) {
    if (n.data?.pinned === true) pinnedIds.add(n.id)
  }

  // Pass 1: depthsWithPinned — O(k) with Set lookup
  const depthsWithPinned = new Set<number>()
  for (const m of participants) {
    if (pinnedIds.has(m.id)) depthsWithPinned.add(m.depth)
  }

  // Pass 2 (merged): hiddenSiblingIds + wideAtFocusDepthIds + layoutParticipants + anyHidden flag
  const hiddenSiblingIds = new Set<string>()
  const wideAtFocusDepthIds = new Set<string>()
  const layoutParticipants: Participant[] = []
  let anyHidden = false
  for (const m of participants) {
    if (m.id !== focusId &&
        ((m.depth === focusDepth || depthsWithPinned.has(m.depth)) && !pinnedIds.has(m.id))) {
      hiddenSiblingIds.add(m.id)
      anyHidden = true
    } else {
      layoutParticipants.push(m)
      if (m.depth === focusDepth && pinnedIds.has(m.id)) wideAtFocusDepthIds.add(m.id)
    }
  }

  return { hiddenSiblingIds, anyHidden, wideAtFocusDepthIds, layoutParticipants }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('applyLayerDrill traversals — no pinned nodes', () => {
  const n60 = makeNodes(60); const p60 = makeParticipants(n60, 4)
  bench('baseline  60 nodes / ~40 participants', () => { drillTraversals_baseline(n60, p60, 1, 'n0') })
  bench('fixed     60 nodes / ~40 participants', () => { drillTraversals_fixed(n60, p60, 1, 'n0') })

  const n150 = makeNodes(150); const p150 = makeParticipants(n150, 5)
  bench('baseline 150 nodes / ~100 participants', () => { drillTraversals_baseline(n150, p150, 1, 'n0') })
  bench('fixed    150 nodes / ~100 participants', () => { drillTraversals_fixed(n150, p150, 1, 'n0') })

  const n300 = makeNodes(300); const p300 = makeParticipants(n300, 6)
  bench('baseline 300 nodes / ~200 participants', () => { drillTraversals_baseline(n300, p300, 1, 'n0') })
  bench('fixed    300 nodes / ~200 participants', () => { drillTraversals_fixed(n300, p300, 1, 'n0') })
})

describe('applyLayerDrill traversals — 10% pinned', () => {
  const n60p = makeNodes(60, 0.1); const p60p = makeParticipants(n60p, 4)
  bench('baseline  60 nodes / ~40 participants / 10% pinned', () => { drillTraversals_baseline(n60p, p60p, 1, 'n0') })
  bench('fixed     60 nodes / ~40 participants / 10% pinned', () => { drillTraversals_fixed(n60p, p60p, 1, 'n0') })

  const n150p = makeNodes(150, 0.1); const p150p = makeParticipants(n150p, 5)
  bench('baseline 150 nodes / ~100 participants / 10% pinned', () => { drillTraversals_baseline(n150p, p150p, 1, 'n0') })
  bench('fixed    150 nodes / ~100 participants / 10% pinned', () => { drillTraversals_fixed(n150p, p150p, 1, 'n0') })

  const n300p = makeNodes(300, 0.1); const p300p = makeParticipants(n300p, 6)
  bench('baseline 300 nodes / ~200 participants / 10% pinned', () => { drillTraversals_baseline(n300p, p300p, 1, 'n0') })
  bench('fixed    300 nodes / ~200 participants / 10% pinned', () => { drillTraversals_fixed(n300p, p300p, 1, 'n0') })
})
