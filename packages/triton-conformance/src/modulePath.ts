/**
 * Map a repo-relative Python file path to a dotted module path. Mirrors the editor's
 * filePathToModulePath (strip a src/ layout, drop the .py / __init__.py suffix). Kept here so the
 * CLI doesn't import the Vite-bound editor parser.
 */
export function filePathToModulePath(relPath: string, sourceRoots: readonly string[] = []): string {
  let rel = relPath.replaceAll('\\', '/').replace(/^\.?\/+/, '')
  for (const raw of sourceRoots) {
    const root = raw.replaceAll('\\', '/').replace(/^\.?\/+/, '').replace(/\/+$/, '')
    if (root && (rel === root || rel.startsWith(`${root}/`))) {
      rel = rel.slice(root.length).replace(/^\/+/, '')
      break
    }
  }
  if (rel.startsWith('src/')) rel = rel.slice('src/'.length)
  if (rel.endsWith('/__init__.py')) rel = rel.slice(0, -'/__init__.py'.length)
  else if (rel.endsWith('.py')) rel = rel.slice(0, -'.py'.length)
  return rel.replaceAll('/', '.')
}
