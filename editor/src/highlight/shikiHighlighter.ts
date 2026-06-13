import { createHighlighter, type Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

/**
 * Grammars loaded into the singleton highlighter. Keep this list small — each grammar adds to the
 * wasm/bundle cost — but it must cover every `LanguageProfile.shikiLang` that should render with real
 * syntax colours. Profiles for languages not in this set use `'text'`, which Shiki always supports
 * as a no-op grammar (plain, escaped text) so the box still renders cleanly.
 */
const LOADED_LANGS = ['scala', 'python', 'typescript', 'javascript'] as const
const LOADED_LANG_SET = new Set<string>(LOADED_LANGS)

/**
 * Cached Shiki highlighter for short, VS Code-like signature rendering.
 *
 * Theme choice: `github-light` — the focused artefact body uses the box's light body fill
 * as its background, so a dark-theme palette (near-white variable names) became invisible.
 * `github-light` is tuned for light canvases: identifiers stay in dark slate, keywords pop in
 * red, types in deep blue — all legible over the ~90%-opaque box body.
 *
 * We load a small fixed set of grammars and keep a singleton so the diagram can render many nodes
 * without creating per-node highlighters.
 */
export async function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light'],
      langs: [...LOADED_LANGS],
    })
  }
  return highlighterPromise
}

/** Narrow an arbitrary profile `shikiLang` to a loaded grammar, falling back to plain text. */
function resolveLang(lang: string | undefined): string {
  return lang && LOADED_LANG_SET.has(lang) ? lang : 'text'
}

/**
 * Render a snippet to Shiki HTML in the given language. Unknown / unloaded languages degrade to
 * plain (escaped) text rather than mis-highlighting as another language.
 */
export async function highlightInline(code: string, lang?: string): Promise<string> {
  const h = await getShikiHighlighter()
  return h.codeToHtml(code, {
    lang: resolveLang(lang),
    theme: 'github-light',
  })
}
