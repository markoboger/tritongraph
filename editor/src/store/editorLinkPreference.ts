import type { ExternalEditorSchemeId } from '../openInEditor'

export type EditorLinkMode = 'internal' | 'external'

/** Editors offered in the preference dialog — matches {@link EXTERNAL_EDITOR_SCHEME_TEMPLATES}. */
export type StoredExternalEditorId = ExternalEditorSchemeId

export interface StoredEditorLinkPreference {
  mode: EditorLinkMode
  externalEditor?: StoredExternalEditorId
  /** Absolute directory joined with relPath for external opens (repo root on disk). */
  externalRepoRoot?: string
}

const STORAGE_KEY = 'triton.editorLinkPrefs.v1'

function readAll(): Record<string, StoredEditorLinkPreference> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as unknown
    return p && typeof p === 'object' ? (p as Record<string, StoredEditorLinkPreference>) : {}
  } catch {
    return {}
  }
}

function writeAll(m: Record<string, StoredEditorLinkPreference>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
  } catch {
    /* quota / private mode */
  }
}

export function getStoredEditorLinkPreference(workspaceKey: string): StoredEditorLinkPreference | null {
  const k = String(workspaceKey ?? '').trim()
  if (!k) return null
  const v = readAll()[k]
  if (!v || (v.mode !== 'internal' && v.mode !== 'external')) return null
  return v
}

export function setStoredEditorLinkPreference(workspaceKey: string, pref: StoredEditorLinkPreference): void {
  const k = String(workspaceKey ?? '').trim()
  if (!k) return
  const all = readAll()
  all[k] = pref
  writeAll(all)
}

export function clearStoredEditorLinkPreference(workspaceKey: string): void {
  const k = String(workspaceKey ?? '').trim()
  if (!k) return
  const all = readAll()
  delete all[k]
  writeAll(all)
}
