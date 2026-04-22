export type DojoFixture = {
  id: string
  fileName: string
  title: string
  yaml: string
}

const dojoModules = import.meta.glob('./fixtures/*.ilograph.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function dojoIdFromPath(path: string): string {
  return path.split('/').pop()?.replace(/\.ilograph\.yaml$/, '') ?? path
}

function titleFromDojoId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

export const dojoFixtures: readonly DojoFixture[] = Object.entries(dojoModules)
  .map(([path, yaml]) => {
    const id = dojoIdFromPath(path)
    return {
      id,
      fileName: `${id}.ilograph.yaml`,
      title: titleFromDojoId(id),
      yaml,
    }
  })
  .sort((a, b) => a.id.localeCompare(b.id))

export function getDojoFixture(id: string): DojoFixture | null {
  const normalized = id.trim().toLowerCase()
  return dojoFixtures.find((fixture) => fixture.id.toLowerCase() === normalized) ?? null
}
