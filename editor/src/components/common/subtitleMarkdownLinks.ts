/**
 * Inline markdown links in box subtitles, e.g. `[packages](triton://diagram/packages?project=api)`.
 * Kept in sync with {@link MarkdownActionSubtitle.vue}.
 */
export const SUBTITLE_INLINE_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

export function subtitleHasMarkdownLinks(text: unknown): boolean {
  const s = String(text ?? '').trim()
  if (!s) return false
  SUBTITLE_INLINE_LINK_RE.lastIndex = 0
  return SUBTITLE_INLINE_LINK_RE.test(s)
}
