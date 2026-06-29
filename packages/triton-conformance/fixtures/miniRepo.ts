/**
 * Tiny synthetic Soll-Modell + changed_facts with known violations (spec Increment 1).
 *
 * A 3-layer Python app: `domain` depends on nothing; `api` and `infra` may depend on `domain`.
 * Two injected violations as ground truth — one each side of the structural/semantic line:
 *   1. STRUCTURAL: app.domain.order imports app.infra.db → forbidden edge domain→infra
 *      (catchable by the deterministic rule-engine).
 *   2. SEMANTIC:   app.domain.pricing.quote takes a `flask.Request` parameter → domain references a
 *      web-framework concept via a signature; not a component→component edge, so only the LLM can
 *      express it.
 * app.api.routes is a clean control (api→domain is allowed; api may use flask).
 */
import type {
  SollModel,
  ResolvedTopology,
  ChangedFact,
  ViolationRecord,
} from '../src/types'
import { buildMatchKey } from '../src/matchKey'

export const topology: ResolvedTopology = {
  moduleToComponent: {
    'app.domain.order': 'domain',
    'app.domain.pricing': 'domain',
    'app.api.routes': 'api',
    'app.infra.db': 'infra',
  },
  components: ['domain', 'api', 'infra'],
  // domain is the inner layer — only api and infra may point at it.
  allowedEdges: [
    { from: 'api', to: 'domain' },
    { from: 'infra', to: 'domain' },
  ],
}

export const sollModel: SollModel = {
  topology,
  rules: [
    {
      id: 'no-domain-framework-coupling',
      category: 'semantic-framework-leak',
      kind: 'semantic',
      scope: { components: ['domain'] },
      statement:
        'Domain logic must not depend on or reference framework concepts (web request/response ' +
        'types, ORM session objects, DI containers), neither via import nor via function signatures.',
      severity: 'error',
    },
  ],
}

export const changedFacts: readonly ChangedFact[] = [
  {
    path: 'app/domain/order.py',
    module: 'app.domain.order',
    component: 'domain',
    diff_kind: 'modified',
    // Forbidden: domain reaching into infra.
    imports: [{ target: 'app.infra.db', target_component: 'infra' }],
    signatures: [
      {
        symbol: 'create_order',
        kind: 'function',
        params: [{ name: 'items', annotation: 'list' }],
        returns: 'app.domain.order.Order',
      },
    ],
  },
  {
    path: 'app/domain/pricing.py',
    module: 'app.domain.pricing',
    component: 'domain',
    diff_kind: 'modified',
    // flask is external/unmapped → not a component edge; the leak is only visible in the signature.
    imports: [{ target: 'flask', target_component: null }],
    signatures: [
      {
        symbol: 'quote',
        kind: 'function',
        params: [{ name: 'req', annotation: 'flask.Request' }],
        returns: 'app.domain.order.Money',
      },
    ],
  },
  {
    // Clean control: api→domain is allowed and api may use flask.
    path: 'app/api/routes.py',
    module: 'app.api.routes',
    component: 'api',
    diff_kind: 'added',
    imports: [
      { target: 'app.domain.order', target_component: 'domain' },
      { target: 'flask', target_component: null },
    ],
    signatures: [
      {
        symbol: 'handle',
        kind: 'function',
        params: [{ name: 'req', annotation: 'flask.Request' }],
        returns: 'flask.Response',
      },
    ],
  },
]

export const expectedViolations: readonly ViolationRecord[] = [
  {
    rule_id: 'DERIVED:forbidden-edge',
    category: 'layer-violation',
    kind: 'structural',
    source: 'rule-engine',
    location: { file: 'app/domain/order.py', module: 'app.domain.order', component: 'domain' },
    subject: { from: 'domain', to: 'infra' },
    reason: 'Module app.domain.order imports app.infra.db; domain (inner layer) must not depend on infra.',
    suggestion: 'Invert the dependency: define a port in domain and implement it in infra.',
    severity: 'error',
    match_key: buildMatchKey(
      'layer-violation',
      { component: 'domain', module: 'app.domain.order' },
      { from: 'domain', to: 'infra' },
    ),
  },
  {
    rule_id: 'no-domain-framework-coupling',
    category: 'semantic-framework-leak',
    kind: 'semantic',
    source: 'llm',
    location: {
      file: 'app/domain/pricing.py',
      module: 'app.domain.pricing',
      component: 'domain',
      symbol: 'quote',
      line: 5,
    },
    subject: { offending_type: 'flask.Request', via: 'signature' },
    reason: 'Parameter req is typed flask.Request; the domain layer thereby references a web-framework concept.',
    suggestion: 'Accept a plain DTO; map the request in the api layer.',
    severity: 'error',
    confidence: 0.82,
    match_key: buildMatchKey(
      'semantic-framework-leak',
      { component: 'domain', module: 'app.domain.pricing' },
      { offending_type: 'flask.Request' },
    ),
  },
]
