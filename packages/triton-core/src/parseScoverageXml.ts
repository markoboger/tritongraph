interface ScoverageRateBase {
  /** Statement coverage percent, 0–100 (already percent, not fraction). */
  statementRate: number
  /**
   * Optional statement count emitted by the XML. When present we can build weighted ancestor
   * rollups instead of falling back to equal-weight averages.
   */
  statementCount?: number
}

export interface ScoverageClassRate extends ScoverageRateBase {
  /** Fully-qualified class name (e.g. `com.example.animalsfruit.animal.Fox`). */
  fullName: string
  /** Package portion of {@link fullName}, or `<root>` for default-package classes. */
  packageName: string
  /** `Class` | `Object` | `Trait` (from scoverage attribute). */
  classType: string
}

export interface ScoveragePackageRate extends ScoverageRateBase {
  /** Fully-qualified package name (`com.example.animalsfruit.birds`). */
  packageName: string
}

export interface ParsedScoverageXml {
  classRates: ScoverageClassRate[]
  packageRates: ScoveragePackageRate[]
  /** Optional aggregate from the root `<scoverage …>` element when present. */
  documentStatementRate?: number
}

function toNumber(v: string | null): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Depth-first: elements whose local name matches (works with default or prefixed XML tags). */
function elementsByLocalName(root: Element | Document | null, localName: string): Element[] {
  if (!root) return []
  const out: Element[] = []
  const docEl =
    'documentElement' in root && root.documentElement ? root.documentElement : (root as Element)
  if (!docEl) return []
  const walk = (node: Node) => {
    if (node.nodeType === 1) {
      const el = node as Element
      if (el.localName === localName) out.push(el)
    }
    for (const c of Array.from(node.childNodes)) walk(c)
  }
  walk(docEl)
  return out
}

function statementRatePercent(el: Element): number | null {
  const direct = toNumber(el.getAttribute('statement-rate'))
  if (direct != null) return direct
  const invoked = toNumber(el.getAttribute('statements-invoked'))
  const total = toNumber(el.getAttribute('statement-count'))
  if (invoked != null && total != null && total > 0) return (invoked / total) * 100
  return null
}

function statementCountFor(el: Element): number | undefined {
  const candidates = [
    'statement-count',
    'statementCount',
    'statements',
    'statements-valid',
    'statementsValid',
  ]
  for (const name of candidates) {
    const n = toNumber(el.getAttribute(name))
    if (n != null && n >= 0) return n
  }
  return undefined
}

/**
 * When `<package>` / `<class>` summary attributes are absent, recover rates from per-statement
 * rows (older and some Scala 3 report shapes).
 */
function parseFromStatementElements(doc: Document): ParsedScoverageXml {
  const stmts = elementsByLocalName(doc, 'statement')
  if (!stmts.length) return { classRates: [], packageRates: [] }

  type Bucket = { total: number; hit: number }
  const pkgMap = new Map<string, Bucket>()
  const classMap = new Map<string, { bucket: Bucket; pkg: string; classType: string }>()

  for (const el of stmts) {
    const ignored = String(el.getAttribute('ignored') ?? '').toLowerCase() === 'true'
    if (ignored) continue
    const pkg = String(el.getAttribute('package') ?? '').trim() || '<root>'
    const fqn = String(el.getAttribute('full-class-name') ?? '').trim()
    const inv = toNumber(el.getAttribute('invocation-count'))
    const hit = inv != null && inv > 0 ? 1 : 0

    const pb = pkgMap.get(pkg) ?? { total: 0, hit: 0 }
    pb.total += 1
    pb.hit += hit
    pkgMap.set(pkg, pb)

    if (fqn) {
      const classType = String(el.getAttribute('class-type') ?? '').trim()
      const prev = classMap.get(fqn)
      const bucket = prev?.bucket ?? { total: 0, hit: 0 }
      bucket.total += 1
      bucket.hit += hit
      classMap.set(fqn, { bucket, pkg, classType })
    }
  }

  const packageRates: ScoveragePackageRate[] = []
  for (const [packageName, { total, hit }] of pkgMap) {
    if (total <= 0) continue
    packageRates.push({
      packageName,
      statementRate: (hit / total) * 100,
      statementCount: total,
    })
  }

  const classRates: ScoverageClassRate[] = []
  for (const [fullName, { bucket, pkg, classType }] of classMap) {
    if (bucket.total <= 0) continue
    classRates.push({
      fullName,
      packageName: pkg,
      classType,
      statementRate: (bucket.hit / bucket.total) * 100,
      statementCount: bucket.total,
    })
  }

  return { classRates, packageRates }
}

/**
 * Some report shapes omit `name` on `<package>` but include a `filename` under `src/.../scala/`.
 */
function packageNameFromScoveragePackageEl(el: Element): string {
  const raw = String(el.getAttribute('name') ?? '').trim()
  if (raw) return raw
  const fn = String(el.getAttribute('filename') ?? '').trim()
  if (!fn) return ''
  const norm = fn.replace(/\\/g, '/')
  const m = norm.match(/\/src\/(?:main|test)\/scala\/(.+)\/[^/]+\.scala$/i)
  if (!m?.[1]) return ''
  return m[1].replace(/\//g, '.')
}

function splitFullName(fullName: string): { packageName: string; simpleName: string } | null {
  if (!fullName) return null
  const dot = fullName.lastIndexOf('.')
  if (dot < 0) return { packageName: '<root>', simpleName: fullName }
  if (dot === 0 || dot === fullName.length - 1) return null
  return {
    packageName: fullName.slice(0, dot),
    simpleName: fullName.slice(dot + 1),
  }
}

/**
 * Parse scoverage XML report to per-class and per-package statement rates.
 *
 * Note: scoverage emits `statement-rate="76.47"` as a percentage (not 0–1).
 */
function documentRootStatementRate(doc: Document): number | undefined {
  const el = doc.documentElement
  if (!el || el.localName !== 'scoverage') return undefined
  const rate = statementRatePercent(el)
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : undefined
}

export function parseScoverageXml(xml: string): ParsedScoverageXml {
  const text = String(xml ?? '').trim()
  if (!text) return { classRates: [], packageRates: [] }
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const packageEls = elementsByLocalName(doc, 'package')
  const classEls = elementsByLocalName(doc, 'class')
  const packageRates: ScoveragePackageRate[] = []
  const classRates: ScoverageClassRate[] = []

  for (const el of packageEls) {
    const packageName = packageNameFromScoveragePackageEl(el)
    if (!packageName) continue
    const rate = statementRatePercent(el)
    if (rate == null) continue
    const entry: ScoveragePackageRate = { packageName, statementRate: rate }
    const count = statementCountFor(el)
    if (count !== undefined) entry.statementCount = count
    packageRates.push(entry)
  }

  for (const el of classEls) {
    const fullName = el.getAttribute('name') ?? ''
    if (!fullName) continue
    const split = splitFullName(fullName)
    if (!split) continue
    const classType = el.getAttribute('class-type') ?? ''
    const rate = statementRatePercent(el)
    if (rate == null) continue
    const entry: ScoverageClassRate = {
      fullName,
      packageName: split.packageName,
      classType,
      statementRate: rate,
    }
    const count = statementCountFor(el)
    if (count !== undefined) entry.statementCount = count
    classRates.push(entry)
  }

  const documentStatementRate = documentRootStatementRate(doc)

  if (!packageRates.length && !classRates.length) {
    const fromStmts = parseFromStatementElements(doc)
    return {
      ...fromStmts,
      ...(documentStatementRate != null ? { documentStatementRate } : {}),
    }
  }
  return { classRates, packageRates, ...(documentStatementRate != null ? { documentStatementRate } : {}) }
}
