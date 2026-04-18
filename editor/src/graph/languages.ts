/** Stable assignment of a language “logo” key per module id (editor chrome only). */
export const LANGUAGE_ICON_IDS = [
  'scala',
  'ts',
  'js',
  'python',
  'java',
  'rust',
  'go',
  'kotlin',
  'ruby',
  'swift',
] as const

export type LanguageIconId = (typeof LANGUAGE_ICON_IDS)[number]

export function languageIconForId(id: string): LanguageIconId {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return LANGUAGE_ICON_IDS[Math.abs(h) % LANGUAGE_ICON_IDS.length]!
}

export function isLanguageIconId(s: unknown): s is LanguageIconId {
  return typeof s === 'string' && (LANGUAGE_ICON_IDS as readonly string[]).includes(s)
}
