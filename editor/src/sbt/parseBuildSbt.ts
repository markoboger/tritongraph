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

export interface SbtSubproject {
  id: string
  baseDir?: string
  dependsOn: string[]
  aggregate: string[]
}

export function parseBuildSbt(source: string): SbtSubproject[] {
  const stripped = stripScalaComments(source)
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
    projects.push({
      id: hits[i]!.id,
      baseDir: extractBaseDir(body),
      dependsOn: refsFromParenCall(body, 'dependsOn'),
      aggregate: refsFromParenCall(body, 'aggregate'),
    })
  }
  return projects
}
