/** Strip `//` line comments and `/* */` blocks (string literals may still contain `//`). */
export function stripScalaComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]!
    const n = source[i + 1]
    if (c === '/' && n === '/') {
      i += 2
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i + 1 < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i = Math.min(source.length, i + 2)
      continue
    }
    out += c
    i++
  }
  return out
}

function splitArgsTopLevel(inner: string): string[] {
  const parts: string[] = []
  let depthParen = 0
  let depthBracket = 0
  let depthBrace = 0
  let cur = ''
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k]!
    if (ch === '(') depthParen++
    else if (ch === ')') depthParen--
    else if (ch === '[') depthBracket++
    else if (ch === ']') depthBracket--
    else if (ch === '{') depthBrace++
    else if (ch === '}') depthBrace--
    if (ch === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      parts.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** First Scala identifier token in a dependsOn / aggregate argument. */
function projectRefFromArg(arg: string): string | undefined {
  const trimmed = arg.trim()
  const lp = trimmed.match(/^LocalProject\s*\(\s*["'](\w+)["']\s*\)/)
  if (lp) return lp[1]
  const id = trimmed.match(/^(\w+)/)
  return id?.[1]
}

function refsFromParenCall(body: string, method: 'dependsOn' | 'aggregate'): string[] {
  const refs: string[] = []
  const re = method === 'dependsOn' ? /\.dependsOn\s*\(/g : /\.aggregate\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const start = m.index + m[0].length
    let depth = 1
    let j = start
    for (; j < body.length && depth > 0; j++) {
      const ch = body[j]!
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    const inner = body.slice(start, j - 1)
    for (const part of splitArgsTopLevel(inner)) {
      const id = projectRefFromArg(part)
      if (id) refs.push(id)
    }
  }
  return refs
}

function extractBaseDir(body: string): string | undefined {
  const m1 = body.match(/\bin\s+file\s*\(\s*["']([^"']*)["']\s*\)/)
  if (m1) return m1[1]
  const m2 = body.match(/\.in\s*\(\s*file\s*\(\s*["']([^"']*)["']\s*\)\s*\)/)
  return m2?.[1]
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s*([,()])\s*/g, '$1').trim()
}

function extractParenCallBodies(body: string, method: string): string[] {
  const out: string[] = []
  const re = new RegExp(`\\.${method}\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const start = m.index + m[0].length
    let depth = 1
    let j = start
    for (; j < body.length && depth > 0; j++) {
      const ch = body[j]!
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    out.push(body.slice(start, j - 1))
  }
  return out
}

function quotedString(expr: string): string | undefined {
  const m = expr.trim().match(/^["']([^"']+)["']/)
  return m?.[1]
}

function parseLibraryDependencyExpr(expr: string): string[] {
  const trimmed = expr.trim().replace(/,\s*$/, '')
  const seq = trimmed.match(/^Seq\s*\(([\s\S]*)\)$/)
  if (!seq) return trimmed ? [compactWhitespace(trimmed)] : []
  return splitArgsTopLevel(seq[1] ?? '')
    .map((part) => compactWhitespace(part.replace(/,\s*$/, '')))
    .filter(Boolean)
}

function findThisBuildSetting(source: string, key: string): string | undefined {
  const re = new RegExp(`(?:^|\\n)\\s*ThisBuild\\s*/\\s*${key}\\s*:=\\s*([^\\n]+)`, 'm')
  const m = source.match(re)
  return m?.[1]?.trim()
}

type ParsedProjectSettings = {
  name?: string
  version?: string
  scalaVersion?: string
  organization?: string
  libraryDependencies: string[]
}

function parseProjectSettings(body: string): ParsedProjectSettings {
  const out: ParsedProjectSettings = {
    libraryDependencies: [],
  }
  for (const settingsBody of extractParenCallBodies(body, 'settings')) {
    for (const part of splitArgsTopLevel(settingsBody)) {
      const line = part.trim()
      const kv = line.match(/^(\w+)\s*:=\s*(.+)$/)
      if (kv) {
        const key = kv[1]!
        const value = quotedString(kv[2] ?? '')
        if (!value) continue
        if (key === 'name') out.name = value
        else if (key === 'version') out.version = value
        else if (key === 'scalaVersion') out.scalaVersion = value
        else if (key === 'organization') out.organization = value
        continue
      }
      const lib = line.match(/^libraryDependencies\s*\+\+?=\s*(.+)$/)
      if (lib) out.libraryDependencies.push(...parseLibraryDependencyExpr(lib[1] ?? ''))
    }
  }
  return out
}

export interface SbtSubproject {
  id: string
  baseDir?: string
  dependsOn: string[]
  aggregate: string[]
  name?: string
  version?: string
  scalaVersion?: string
  organization?: string
  libraryDependencies: string[]
}

export function parseBuildSbt(source: string): SbtSubproject[] {
  const stripped = stripScalaComments(source)
  const globalScalaVersion = quotedString(findThisBuildSetting(stripped, 'scalaVersion') ?? '')
  const globalVersion = quotedString(findThisBuildSetting(stripped, 'version') ?? '')
  const globalOrganization = quotedString(findThisBuildSetting(stripped, 'organization') ?? '')
  const re = /(?:^|\n)\s*lazy val\s+(\w+)\s*=\s*/gm
  const hits: { id: string; headerEnd: number; blockStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    hits.push({ id: m[1]!, headerEnd: m.index + m[0].length, blockStart: m.index })
  }
  const projects: SbtSubproject[] = []
  for (let i = 0; i < hits.length; i++) {
    const bodyEnd = i + 1 < hits.length ? hits[i + 1]!.blockStart : stripped.length
    const body = stripped.slice(hits[i]!.headerEnd, bodyEnd)
    if (!/\bproject\b/.test(body)) continue
    const settings = parseProjectSettings(body)
    projects.push({
      id: hits[i]!.id,
      baseDir: extractBaseDir(body),
      dependsOn: refsFromParenCall(body, 'dependsOn'),
      aggregate: refsFromParenCall(body, 'aggregate'),
      name: settings.name,
      version: settings.version ?? globalVersion,
      scalaVersion: settings.scalaVersion ?? globalScalaVersion,
      organization: settings.organization ?? globalOrganization,
      libraryDependencies: settings.libraryDependencies,
    })
  }
  return projects
}
