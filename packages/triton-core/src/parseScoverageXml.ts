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
}

function toNumber(v: string | null): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
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
export function parseScoverageXml(xml: string): ParsedScoverageXml {
  const text = String(xml ?? '').trim()
  if (!text) return { classRates: [], packageRates: [] }
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const packageEls = Array.from(doc.getElementsByTagName('package'))
  const classEls = Array.from(doc.getElementsByTagName('class'))
  const packageRates: ScoveragePackageRate[] = []
  const classRates: ScoverageClassRate[] = []

  for (const el of packageEls) {
    const packageName = el.getAttribute('name') ?? ''
    if (!packageName) continue
    const rate = toNumber(el.getAttribute('statement-rate'))
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
    const rate = toNumber(el.getAttribute('statement-rate'))
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
  return { classRates, packageRates }
}
