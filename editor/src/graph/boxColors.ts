/** CSS named colors only — used for module accents and YAML round-trip. */
export const NAMED_BOX_COLORS = [
  'steelblue',
  'coral',
  'seagreen',
  'goldenrod',
  'mediumpurple',
  'indianred',
  'cadetblue',
  'chocolate',
  'darkcyan',
  'orchid',
  'peru',
  'slategray',
  'tomato',
  'darkseagreen',
  'cornflowerblue',
  'darksalmon',
  'mediumturquoise',
  'forestgreen',
  'sienna',
  'royalblue',
] as const

export type NamedBoxColor = (typeof NAMED_BOX_COLORS)[number]

const SET = new Set<string>(NAMED_BOX_COLORS)

export function isNamedBoxColor(s: unknown): s is NamedBoxColor {
  return typeof s === 'string' && SET.has(s)
}

export function boxColorForId(id: string): NamedBoxColor {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const idx = Math.abs(h) % NAMED_BOX_COLORS.length
  return NAMED_BOX_COLORS[idx]!
}

export function nextNamedBoxColor(current: string): NamedBoxColor {
  const i = NAMED_BOX_COLORS.indexOf(current as NamedBoxColor)
  const next = (i >= 0 ? i + 1 : 0) % NAMED_BOX_COLORS.length
  return NAMED_BOX_COLORS[next]!
}
