export function extractLeadingBlockComment(text: string, startRow0: number): string {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const start = Math.max(0, Math.min(lines.length - 1, startRow0))
  let i = start - 1
  while (i >= 0 && lines[i]!.trim() === '') i--
  if (i < 0) return ''
  if (!lines[i]!.includes('*/')) return ''
  let end = i
  while (i >= 0 && !lines[i]!.includes('/**')) i--
  if (i < 0) return ''
  const raw = lines.slice(i, end + 1).join('\n')
  const inner = raw
    .replace(/^\/\*\*\s*/m, '')
    .replace(/\*\/\s*$/m, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim()
  return inner
}

