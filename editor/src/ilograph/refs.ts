/**
 * Ilograph relation `from` / `to` may be comma-separated resource identifiers.
 */

export function splitRefs(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function resourceKey(resource: { id?: string; name: string }): string {
  return (resource.id ?? resource.name).trim()
}
