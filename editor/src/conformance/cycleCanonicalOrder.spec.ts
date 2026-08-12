/**
 * B24 — canonical edge choice for cycle findings (Decision Record M).
 *
 * Which back-edge of a cycle gets reported is a property of the DFS, so before the sort in
 * cycleViolations it followed the order the imports happened to arrive in: the same cycle blamed
 * `catalog` or `payments` depending on which file the extractor listed first. The match_key is the
 * eval's join key, so that made the ground-truth join depend on file naming.
 *
 * The expected match_key is pinned as a literal, never recomputed with buildMatchKey — a test that
 * derives its expectation from the code under test cannot detect the code changing.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  runRuleEngine,
  observedImportsFromFacts,
  type ObservedImport,
} from '../../../packages/triton-conformance/src/ruleEngine'
import { extractFacts, pythonFilesUnder } from '../../../packages/triton-conformance/src/cliExtractor'
import type { ChangedFact, ResolvedTopology } from '../../../packages/triton-conformance/src/types'

/**
 * Two components, two edges, one cycle. Both directions are whitelisted so the ONLY finding can be
 * the cycle — a forbidden-edge record would otherwise mask which record the assertions are about.
 */
const topology: ResolvedTopology = {
  moduleToComponent: {
    'shop.catalog.items': 'catalog',
    'shop.payments.billing': 'payments',
  },
  components: ['catalog', 'payments'],
  allowedEdges: [
    { from: 'catalog', to: 'payments' },
    { from: 'payments', to: 'catalog' },
  ],
}

/**
 * The canonical answer, as a literal. `catalog` sorts before `payments`, so the DFS roots there,
 * descends catalog → payments, and the edge that closes the cycle is the one pointing back at the
 * root: payments → catalog, witnessed by the module in `payments` that holds the import.
 */
const EXPECTED_MATCH_KEY = 'cycle|payments|shop.payments.billing|payments->catalog'
const EXPECTED_MODULE = 'shop.payments.billing'
const EXPECTED_FILE = 'shop/payments/billing.py'

const CATALOG_TO_PAYMENTS: ObservedImport = {
  fromModule: 'shop.catalog.items',
  toModule: 'shop.payments.billing',
  file: 'shop/catalog/items.py',
  line: 1,
}
const PAYMENTS_TO_CATALOG: ObservedImport = {
  fromModule: 'shop.payments.billing',
  toModule: 'shop.catalog.items',
  file: 'shop/payments/billing.py',
  line: 1,
}

/** Every ordering of `items`, as arrays. 2 items → 2 orderings, 3 → 6. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  )
}

function cyclesOf(imports: readonly ObservedImport[]) {
  return runRuleEngine(imports, topology).filter((v) => v.rule_id === 'DERIVED:cycle')
}

describe('B24 — cycle records are invariant under input order', () => {
  it('reports the same single record for both orderings of the two edges', () => {
    const orderings = permutations([CATALOG_TO_PAYMENTS, PAYMENTS_TO_CATALOG])
    expect(orderings).toHaveLength(2)

    for (const imports of orderings) {
      const cycles = cyclesOf(imports)
      expect(cycles).toHaveLength(1)
      expect(cycles[0].match_key).toBe(EXPECTED_MATCH_KEY)
      expect(cycles[0].location.module).toBe(EXPECTED_MODULE)
      expect(cycles[0].location.file).toBe(EXPECTED_FILE)
      expect(cycles[0].subject).toEqual({ from: 'payments', to: 'catalog' })
    }
  })

  it('stays invariant when an unrelated edge is interleaved, over all 6 orderings', () => {
    // A third module in `catalog` adds a second edge catalog → payments: it changes the adjacency
    // list of the root node, which is exactly what the per-node sort has to neutralize.
    const extra: ObservedImport = {
      fromModule: 'shop.catalog.search',
      toModule: 'shop.payments.billing',
      file: 'shop/catalog/search.py',
      line: 2,
    }
    const withExtra: ResolvedTopology = {
      ...topology,
      moduleToComponent: { ...topology.moduleToComponent, 'shop.catalog.search': 'catalog' },
    }

    const orderings = permutations([CATALOG_TO_PAYMENTS, PAYMENTS_TO_CATALOG, extra])
    expect(orderings).toHaveLength(6)

    for (const imports of orderings) {
      const cycles = runRuleEngine(imports, withExtra).filter((v) => v.rule_id === 'DERIVED:cycle')
      expect(cycles).toHaveLength(1)
      expect(cycles[0].match_key).toBe(EXPECTED_MATCH_KEY)
    }
  })

  it('stays invariant across both file orderings through observedImportsFromFacts', () => {
    // The production entry point the CLI uses. File order here is what the extractor produces:
    // sorted in --rule-graph full, git-diff order in --rule-graph diff.
    const catalogFact: ChangedFact = {
      path: 'shop/catalog/items.py',
      module: 'shop.catalog.items',
      component: 'catalog',
      diff_kind: 'modified',
      imports: [{ target: 'shop.payments.billing', target_component: 'payments' }],
      signatures: [],
    }
    const paymentsFact: ChangedFact = {
      path: 'shop/payments/billing.py',
      module: 'shop.payments.billing',
      component: 'payments',
      diff_kind: 'modified',
      imports: [{ target: 'shop.catalog.items', target_component: 'catalog' }],
      signatures: [],
    }

    for (const facts of [
      [catalogFact, paymentsFact],
      [paymentsFact, catalogFact],
    ]) {
      const cycles = cyclesOf(observedImportsFromFacts(facts))
      expect(cycles).toHaveLength(1)
      expect(cycles[0].match_key).toBe(EXPECTED_MATCH_KEY)
      expect(cycles[0].location.module).toBe(EXPECTED_MODULE)
    }
  })
})

const repos: string[] = []
afterAll(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'triton-b24-'))
  repos.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

describe('B24 — diff and full rule-graph agree on the cycle record', () => {
  it('yields the same match_key in both modes when both edges are in the graph', () => {
    const repo = writeRepo({
      'shop/catalog/items.py': 'from shop.payments.billing import price\n',
      'shop/payments/billing.py': 'from shop.catalog.items import Item\n',
    })

    // --rule-graph diff: both files changed, and deliberately in the REVERSE of the sorted order a
    // full walk produces — that difference is precisely what used to flip the reported module.
    const changed = [
      { path: 'shop/payments/billing.py', diff_kind: 'modified' as const },
      { path: 'shop/catalog/items.py', diff_kind: 'modified' as const },
    ]
    const diff = extractFacts(repo, changed, topology)
    expect(diff.facts.map((f) => f.path)).toEqual([
      'shop/payments/billing.py',
      'shop/catalog/items.py',
    ])

    // --rule-graph full: every *.py under the roots, sorted by pythonFilesUnder.
    const full = extractFacts(repo, pythonFilesUnder(repo), topology)
    expect(full.facts.map((f) => f.path)).toEqual([
      'shop/catalog/items.py',
      'shop/payments/billing.py',
    ])

    const diffCycles = cyclesOf(observedImportsFromFacts(diff.facts))
    const fullCycles = cyclesOf(observedImportsFromFacts(full.facts))

    expect(diffCycles).toHaveLength(1)
    expect(fullCycles).toHaveLength(1)
    expect(diffCycles[0].match_key).toBe(EXPECTED_MATCH_KEY)
    expect(fullCycles[0].match_key).toBe(EXPECTED_MATCH_KEY)
    expect(diffCycles[0].location).toEqual(fullCycles[0].location)
    expect(diffCycles[0].subject).toEqual(fullCycles[0].subject)
  })

  it('finds no cycle in diff mode when only one of the two edges is in the diff', () => {
    // Not a defect and not an inconsistency in the canonical order: diff mode simply has fewer
    // edges. The premise of the agreement above is that both edges are in the graph.
    const repo = writeRepo({
      'shop/catalog/items.py': 'from shop.payments.billing import price\n',
      'shop/payments/billing.py': 'from shop.catalog.items import Item\n',
    })
    const partial = extractFacts(repo, [{ path: 'shop/catalog/items.py', diff_kind: 'modified' }], topology)

    expect(cyclesOf(observedImportsFromFacts(partial.facts))).toHaveLength(0)
    expect(cyclesOf(observedImportsFromFacts(extractFacts(repo, pythonFilesUnder(repo), topology).facts)))
      .toHaveLength(1)
  })
})
