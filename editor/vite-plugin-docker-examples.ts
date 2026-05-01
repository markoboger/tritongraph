import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

/**
 * Serves `GET /docker-examples/*` from `<repoRoot>/docker-examples` in dev, and copies that tree
 * into `dist/docker-examples` on production build (so `fetch('/docker-examples/…')` works without
 * duplicating files under `editor/public/`).
 */
export function dockerExamplesStaticPlugin(repoRoot: string): Plugin[] {
  const srcDir = path.join(repoRoot, 'docker-examples')
  let outDir = ''

  function resolveUnderSrc(urlPath: string): string | null {
    const rel = urlPath.replace(/^\/+/, '')
    const decoded = decodeURIComponent(rel.split('?')[0] ?? '')
    if (!decoded || decoded.includes('..')) return null
    const abs = path.join(srcDir, decoded)
    const normSrc = path.normalize(srcDir + path.sep)
    const normAbs = path.normalize(abs)
    if (!normAbs.startsWith(normSrc)) return null
    return normAbs
  }

  const devMiddleware: Parameters<ViteDevServer['middlewares']['use']>[0] = (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/docker-examples/')) {
      next()
      return
    }
    if (!fs.existsSync(srcDir)) {
      res.statusCode = 404
      res.end('docker-examples directory missing')
      return
    }
    const abs = resolveUnderSrc(url.slice('/docker-examples/'.length))
    if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    const ext = path.extname(abs).toLowerCase()
    const type =
      ext === '.yaml' || ext === '.yml'
        ? 'text/yaml; charset=utf-8'
        : ext === '.json'
          ? 'application/json; charset=utf-8'
          : 'text/plain; charset=utf-8'
    res.setHeader('Content-Type', type)
    res.end(fs.readFileSync(abs))
  }

  return [
    {
      name: 'docker-examples:dev',
      apply: 'serve',
      configureServer(server: ViteDevServer) {
        server.middlewares.use(devMiddleware)
      },
    },
    {
      name: 'docker-examples:build',
      apply: 'build',
      configResolved(config) {
        outDir = path.resolve(config.root, config.build.outDir)
      },
      closeBundle() {
        if (!fs.existsSync(srcDir)) return
        const dest = path.join(outDir, 'docker-examples')
        fs.mkdirSync(outDir, { recursive: true })
        fs.cpSync(srcDir, dest, { recursive: true })
      },
    },
  ]
}
