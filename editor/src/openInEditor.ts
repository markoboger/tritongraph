/**
 * Opens a source file in the user's configured external editor via a URL-scheme handoff.
 *
 * Flow:
 *   1. `.triton.yaml` is read by `vite-plugin-triton-config.ts` at dev/build start.
 *   2. Its `editor` block is surfaced to the browser as `virtual:triton-config`.
 *   3. If the page URL carries an `ideOpenUrl` query param (injected by the VS Code / Cursor
 *      extension), {@link openInEditor} treats it as a callback template and interpolates
 *      `{relPath}`, `{absPath}`, `{line}`, `{col}` directly into that URI.
 *   4. Otherwise it resolves the click site's `(root, exampleDir, relPath, line)` into an
 *      absolute path, interpolates the configured preset/template, and triggers
 *      `window.location.href`.
 *   4. The browser dispatches the URL scheme (`cursor://…`, `vscode://…`, …); the OS routes it
 *      to the registered app, which jumps the file+line into view. No native bridge required.
 *
 * Why `window.location.href` and not `window.open`?
 *   Protocol-scheme links generally don't produce a real page navigation — browsers hand them
 *   off and stay on the current tab. Assigning `location.href` is the most broadly-supported
 *   way to trigger this handoff from a user-gesture-initiated click without getting blocked as
 *   a popup (which `window.open` sometimes is for non-http(s) schemes).
 */
import { config, repoRoot } from 'virtual:triton-config'

/** Maps the `editor.name` preset to a URL template. Kept in sync with `.triton.yaml` comment. */
const PRESET_TEMPLATES: Record<string, string> = {
  cursor: 'cursor://file/{absPath}:{line}:{col}',
  vscode: 'vscode://file/{absPath}:{line}:{col}',
  'vscode-insiders': 'vscode-insiders://file/{absPath}:{line}:{col}',
  windsurf: 'windsurf://file/{absPath}:{line}:{col}',
  // IntelliJ family uses a query-string scheme (JetBrains Toolbox / IDE built-in handler).
  idea: 'idea://open?file={absPath}&line={line}&column={col}',
  zed: 'zed://file/{absPath}:{line}:{col}',
}

/** Presets exposed for saved user preference ({@link editor/src/store/editorLinkPreference.ts}). */
export const EXTERNAL_EDITOR_SCHEME_TEMPLATES = {
  cursor: PRESET_TEMPLATES.cursor,
  vscode: PRESET_TEMPLATES.vscode,
  'vscode-insiders': PRESET_TEMPLATES['vscode-insiders'],
  windsurf: PRESET_TEMPLATES.windsurf,
} as const

export type ExternalEditorSchemeId = keyof typeof EXTERNAL_EDITOR_SCHEME_TEMPLATES

/** Fallback when neither `urlTemplate` nor a recognised `name` is present in the YAML. */
const FALLBACK_TEMPLATE = PRESET_TEMPLATES.cursor

function queryTemplateFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('ideOpenUrl')?.trim()
  return value || null
}

/** Return the effective URL template after resolving preset + override precedence. */
function resolveTemplate(): string {
  const queryTpl = queryTemplateFromLocation()
  if (queryTpl) return queryTpl
  const tpl = config.editor.urlTemplate?.trim()
  if (tpl) return tpl
  const name = (config.editor.name ?? '').trim().toLowerCase()
  return PRESET_TEMPLATES[name] ?? FALLBACK_TEMPLATE
}

export interface OpenInEditorTarget {
  /** Examples-root name from `LoadedScalaFile.root` (`scala-examples`, `sbt-examples`, …). */
  root: string
  /** Example folder name under `root` (`animal-fruit`, `01-single-module`, …). */
  exampleDir: string
  /** POSIX-style path relative to `<root>/<exampleDir>` — matches `LoadedScalaFile.relPath`. */
  relPath: string
  /**
   * Absolute base directory override.
   *
   * Used for runtime workspaces where the sources live outside `repoRoot` (e.g. an arbitrary
   * checkout on disk). When set, `root` / `exampleDir` are ignored for absolute-path building.
   */
  absBaseDir?: string
  /** 1-indexed line; defaults to 1 when omitted. Tree-sitter `startRow` is 0-indexed so add 1 upstream. */
  line?: number
  /** 1-indexed column; defaults to 1. */
  col?: number
}

function buildAbsPath(t: OpenInEditorTarget): string {
  if (t.absBaseDir && typeof t.absBaseDir === 'string' && t.absBaseDir.trim()) {
    const parts = [t.absBaseDir, t.relPath].filter(Boolean)
    return parts.join('/').replace(/\/+/g, '/')
  }
  // Everything the editor bundles already uses POSIX separators (the vite plugins normalise
  // Windows paths on the way in); we keep that here so the template sees consistent slashes
  // even on Windows hosts, which Cursor / VS Code tolerate for `file://` and their custom schemes.
  const parts = [repoRoot, t.root, t.exampleDir, t.relPath].filter(Boolean)
  return parts.join('/').replace(/\/+/g, '/')
}

function interpolate(
  template: string,
  target: OpenInEditorTarget,
  absPath: string,
  line: number,
  col: number,
): string {
  return template
    .replaceAll('{root}', target.root)
    .replaceAll('{exampleDir}', target.exampleDir)
    .replaceAll('{relPath}', target.relPath)
    .replaceAll('{absPath}', absPath)
    .replaceAll('{line}', String(line))
    .replaceAll('{col}', String(col))
}

/**
 * Open using an explicit URL template (e.g. saved user preference). Same interpolation tokens as
 * {@link openInEditor}.
 */
export function openInEditorWithTemplate(target: OpenInEditorTarget, template: string): string {
  const line = Math.max(1, target.line ?? 1)
  const col = Math.max(1, target.col ?? 1)
  const absPath = buildAbsPath(target)
  const url = interpolate(template, target, absPath, line, col)
  if (typeof window !== 'undefined') {
    window.location.href = url
  }
  return url
}

/**
 * Open {@link OpenInEditorTarget} in the configured external editor.
 * Returns the URL that was dispatched, for logging / test assertions.
 */
export function openInEditor(target: OpenInEditorTarget): string {
  return openInEditorWithTemplate(target, resolveTemplate())
}

/** Human-readable name for tooltips (`Open in Cursor`). Falls back to 'external editor'. */
export function editorDisplayName(): string {
  const name = (config.editor.name ?? '').trim()
  if (!name) return 'external editor'
  const pretty: Record<string, string> = {
    cursor: 'Cursor',
    vscode: 'VS Code',
    'vscode-insiders': 'VS Code Insiders',
    windsurf: 'Windsurf',
    idea: 'IntelliJ IDEA',
    zed: 'Zed',
  }
  return pretty[name.toLowerCase()] ?? name
}
