import { createHighlighter, type Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

/**
 * Cached Shiki highlighter for short, VS Code-like signature rendering.
 *
 * Theme choice: `github-light` — the focused artefact body uses the box's light body fill
 * as its background, so a dark-theme palette (near-white variable names) became invisible.
 * `github-light` is tuned for light canvases: identifiers stay in dark slate, keywords pop in
 * red, types in deep blue — all legible over the ~90%-opaque box body.
 *
 * We intentionally load only what we need (Scala + one theme) and keep a singleton so the
 * diagram can render many nodes without creating per-node highlighters.
 */
export async function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light'],
      langs: ['scala'],
    })
  }
  return highlighterPromise
}

export async function highlightScalaInline(code: string): Promise<string> {
  const h = await getShikiHighlighter()
  return h.codeToHtml(code, {
    lang: 'scala',
    theme: 'github-light',
  })
}

