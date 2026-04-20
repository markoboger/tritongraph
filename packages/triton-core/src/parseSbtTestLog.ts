/**
 * Parse `sbt test` console output captured to a log file.
 *
 * The ScalaTest (via sbt) default output is a repeating pattern:
 *   [info] SuiteNameSpec:
 *   [info] SubjectUnderTest
 *   [info] - should ...
 *   [info] - should ...
 *
 * We strip the `[info]` prefix but otherwise preserve the checklist-like shape so the UI
 * can render it exactly as the console shows it.
 */
export interface ParsedSbtSuiteBlock {
  suite: string
  subject: string
  /**
   * All console lines belonging to this suite block (suite + subject + subsequent lines),
   * with the `[info]`/`[error]` prefix stripped but the rest preserved.
   *
   * Includes failures and their messages when present (e.g. `*** FAILED ***`, stack trace
   * snippets), so the UI can show the checklist exactly like the console.
   */
  lines: string[]
  /** The full block as console-like text (suite + subject + items). */
  blockText: string
}

const INFO_PREFIX_RE = /^\s*\[(info|success|warn|error)\]\s*/i

function stripPrefix(line: string): string {
  return line.replace(INFO_PREFIX_RE, '')
}

export function parseSbtTestLog(text: string): ParsedSbtSuiteBlock[] {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => stripPrefix(l).trimEnd())
    .filter((l) => l.length > 0)

  const out: ParsedSbtSuiteBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.endsWith('Spec:')) {
      i++
      continue
    }
    const suite = line
    const subject = lines[i + 1] ?? ''
    const blockLines: string[] = []
    let j = i + 2
    while (j < lines.length) {
      const cur = lines[j] ?? ''
      if (cur.endsWith('Spec:')) break
      blockLines.push(cur)
      j++
    }
    const all = [suite, subject, ...blockLines].filter(Boolean)
    out.push({
      suite,
      subject,
      lines: all,
      blockText: all.join('\n'),
    })
    i = j
  }
  return out
}
