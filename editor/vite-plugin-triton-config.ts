import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import yaml from 'js-yaml'

/**
 * Shape of `.triton.yaml` after parsing. All fields are optional; we merge with
 * {@link DEFAULT_CONFIG} at load time so the browser bundle always sees a complete object.
 */
export interface TritonEditorConfig {
  /** Preset shortcut. See `editor/vite-plugin-triton-config.ts` for the built-in table. */
  name?: string
  /** Explicit URL template. When set, overrides `name`. Placeholders: `{absPath}`, `{line}`, `{col}`. */
  urlTemplate?: string
}

export interface TritonConfig {
  editor: TritonEditorConfig
}

const DEFAULT_CONFIG: TritonConfig = {
  editor: { name: 'cursor' },
}

const RESOLVED = 'virtual:triton-config'
const VIRTUAL_ID = '\0' + RESOLVED

interface VirtualModulePayload {
  /** Absolute git-repo root — used by the browser to resolve `relPath → absPath`. POSIX-style. */
  repoRoot: string
  /** Parsed `.triton.yaml`, merged over {@link DEFAULT_CONFIG}. Always has `editor.name`. */
  config: TritonConfig
}

function readConfig(repoRoot: string): TritonConfig {
  const configPath = path.join(repoRoot, '.triton.yaml')
  if (!fs.existsSync(configPath)) return DEFAULT_CONFIG
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = yaml.load(raw) as Partial<TritonConfig> | null | undefined
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CONFIG
    return {
      editor: { ...DEFAULT_CONFIG.editor, ...(parsed.editor ?? {}) },
    }
  } catch (err) {
    // Keep the dev server alive when the YAML is malformed — fall back to defaults and log once.
    // eslint-disable-next-line no-console
    console.warn('[triton-config] failed to parse .triton.yaml, using defaults:', err)
    return DEFAULT_CONFIG
  }
}

/**
 * Exposes `.triton.yaml` (plus the repo root) to the browser bundle as the
 * `virtual:triton-config` module. Watches the file in dev so edits hot-reload.
 *
 * Consumer (in `editor/src`):
 *   import { repoRoot, config } from 'virtual:triton-config'
 */
export function tritonConfigVirtualModule(repoRoot: string): Plugin {
  const normalizedRoot = repoRoot.split(path.sep).join('/')
  let cached = readConfig(repoRoot)
  return {
    name: 'virtual:triton-config',
    enforce: 'pre',
    resolveId(id) {
      if (id === RESOLVED || id.startsWith(`${RESOLVED}?`)) return VIRTUAL_ID
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      this.addWatchFile(path.join(repoRoot, '.triton.yaml'))
      cached = readConfig(repoRoot)
      const payload: VirtualModulePayload = { repoRoot: normalizedRoot, config: cached }
      return (
        `export const repoRoot = ${JSON.stringify(payload.repoRoot)}\n` +
        `export const config = ${JSON.stringify(payload.config)}\n`
      )
    },
    handleHotUpdate(ctx) {
      // When `.triton.yaml` changes we want the virtual module re-emitted so the UI picks
      // up the new editor preset without a manual reload. Invalidating the virtual id makes
      // Vite call `load` again and triggers an HMR update to every importer.
      if (path.resolve(ctx.file) === path.join(repoRoot, '.triton.yaml')) {
        const mod = ctx.server.moduleGraph.getModuleById(VIRTUAL_ID)
        if (mod) return [mod]
      }
      return undefined
    },
  }
}
