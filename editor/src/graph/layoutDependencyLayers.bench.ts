/**
 * Performance benchmarks for layoutDepthInViewport and the layout helpers it calls.
 *
 * Run baseline:  npx vitest bench --outputJson bench-baseline.json
 * Run after fix: npx vitest bench --compare bench-baseline.json --outputJson bench-after.json
 *
 * Scenarios are sized to make the O(n²) findIndex pattern in layoutOneParent measurable:
 *   flat-N   — N root-level module nodes with a chain of dependency edges (no groups)
 *   nested-G×L — G root-level group nodes each containing L package leaves with internal edges
 *
 * In layoutOneParent, every visible and hidden child does `out.findIndex(x => x.id === child.id)`
 * where `out` is the FULL node array.  For flat-60, that is 60 children × 60-node scan = 3 600
 * comparisons per layout call.  For nested-6×20, it is 20 children × 126-node scan × 6 regions
 * = 15 120 comparisons.  The fix replaces every findIndex with a pre-built Map<id, index>.
 */
import { bench, describe } from 'vitest'
import { layoutDepthInViewport } from './layoutDependencyLayers'

// ---------------------------------------------------------------------------
// Data generators
// ---------------------------------------------------------------------------

function makeNode(id: string, type: string, parentNode?: string) {
  return {
    id,
    type,
    parentNode,
    position: { x: 0, y: 0 },
    width: 200,
    height: 72,
    data: {},
    style: { width: '200px', height: '72px', opacity: 1, pointerEvents: 'auto' },
  }
}

function makeEdge(source: string, target: string) {
  return { source, target, label: 'depends on' }
}

/**
 * Flat diagram: N root-level `module` nodes arranged in a layered dependency chain.
 * Each node depends on the next, plus every 4th node skips two ahead — produces
 * a realistic multi-column depth layout (depth ≈ N/3).
 */
function flatDiagram(n: number) {
  const nodes = Array.from({ length: n }, (_, i) => makeNode(`m${i}`, 'module'))
  const edges: ReturnType<typeof makeEdge>[] = []
  for (let i = 0; i < n - 1; i++) {
    edges.push(makeEdge(`m${i}`, `m${i + 1}`))
    if (i % 4 === 0 && i + 3 < n) edges.push(makeEdge(`m${i}`, `m${i + 3}`))
  }
  return { nodes, edges }
}

/**
 * Nested diagram: G root-level `group` nodes each owning L `package` leaf nodes.
 * Within each group, leaves form a chain of dependency edges (depth ≈ L/3).
 * `out` array in layoutOneParent for each group region has G+G*L = G*(1+L) entries.
 */
function nestedDiagram(g: number, l: number) {
  const nodes: ReturnType<typeof makeNode>[] = []
  const edges: ReturnType<typeof makeEdge>[] = []
  for (let gi = 0; gi < g; gi++) {
    const gid = `g${gi}`
    nodes.push({ ...makeNode(gid, 'group'), width: 800, height: 600, style: { width: '800px', height: '600px', opacity: 1, pointerEvents: 'auto' }, data: { packageScope: false } })
    for (let li = 0; li < l; li++) {
      const lid = `g${gi}l${li}`
      nodes.push(makeNode(lid, 'package', gid))
      if (li + 1 < l) edges.push(makeEdge(lid, `g${gi}l${li + 1}`))
      if (li % 4 === 0 && li + 3 < l) edges.push(makeEdge(lid, `g${gi}l${li + 3}`))
    }
  }
  return { nodes, edges }
}

const viewport = { width: 1400, height: 900 }

// ---------------------------------------------------------------------------
// Flat diagrams — `out` size equals node count, one region (root)
// ---------------------------------------------------------------------------

describe('layoutDepthInViewport — flat', () => {
  const s30 = flatDiagram(30)
  bench('flat 30 modules', () => {
    layoutDepthInViewport(s30.nodes, s30.edges, viewport)
  })

  const s60 = flatDiagram(60)
  bench('flat 60 modules', () => {
    layoutDepthInViewport(s60.nodes, s60.edges, viewport)
  })

  const s100 = flatDiagram(100)
  bench('flat 100 modules', () => {
    layoutDepthInViewport(s100.nodes, s100.edges, viewport)
  })
})

// ---------------------------------------------------------------------------
// Nested diagrams — `out` covers all nodes; layoutOneParent called per group
// ---------------------------------------------------------------------------

describe('layoutDepthInViewport — nested groups', () => {
  const n4x15 = nestedDiagram(4, 15)  // 4 groups × 15 leaves = 64 nodes total
  bench('nested 4 groups × 15 leaves (64 nodes)', () => {
    layoutDepthInViewport(n4x15.nodes, n4x15.edges, viewport)
  })

  const n6x20 = nestedDiagram(6, 20)  // 6 groups × 20 leaves = 126 nodes total
  bench('nested 6 groups × 20 leaves (126 nodes)', () => {
    layoutDepthInViewport(n6x20.nodes, n6x20.edges, viewport)
  })

  const n8x30 = nestedDiagram(8, 30)  // 8 groups × 30 leaves = 248 nodes total
  bench('nested 8 groups × 30 leaves (248 nodes)', () => {
    layoutDepthInViewport(n8x30.nodes, n8x30.edges, viewport)
  })
})
