import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { sbtExamplesVirtualModule } from './vite-plugin-sbt-examples'
import { sbtTestLogsVirtualModule } from './vite-plugin-sbt-test-logs'
import { scalaSourcesVirtualModule } from './vite-plugin-scala-sources'
import { scoverageReportsVirtualModule } from './vite-plugin-scoverage-reports'
import { tritonConfigVirtualModule } from './vite-plugin-triton-config'
import { tsExamplesVirtualModule } from './vite-plugin-ts-examples'
import { dockerExamplesStaticPlugin } from './vite-plugin-docker-examples'

const require = createRequire(import.meta.url)
const monacoEditorMod = require('vite-plugin-monaco-editor') as
  | ((opts: { languageWorkers?: string[] }) => import('vite').Plugin)
  | { default: (opts: { languageWorkers?: string[] }) => import('vite').Plugin }
const monacoEditorPlugin =
  typeof monacoEditorMod === 'function' ? monacoEditorMod : (monacoEditorMod as { default: typeof monacoEditorMod }).default

const dirname = path.dirname(fileURLToPath(import.meta.url))
/**
 * Repo-root example folders scanned for `<dir>/build.sbt` and bundled Scala sources:
 *   - `sbt-examples`    : tutorial / large-OSS sbt builds (numbered 01-…).
 *   - `scala-examples`  : nested packages, package-graph parser exercises.
 *   - `docker-examples` : Compose-backed samples that also ship a root `build.sbt` (e.g. 06).
 */
const repoRoot = path.resolve(dirname, '..')
const exampleRoots = [
  { name: 'sbt-examples', dir: path.resolve(repoRoot, 'sbt-examples') },
  { name: 'scala-examples', dir: path.resolve(repoRoot, 'scala-examples') },
  { name: 'docker-examples', dir: path.resolve(repoRoot, 'docker-examples') },
]
const tsExampleRoots = [{ name: 'ts-examples', dir: path.resolve(repoRoot, 'ts-examples') }]

export default defineConfig({
  /** Keep SVG/PNG URLs as separate `/assets/*` files so `<img src>` works in strict embeds (long `data:image/svg+xml` blobs in the main chunk have been seen to break). */
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [
    vue(),
    ...dockerExamplesStaticPlugin(repoRoot),
    sbtExamplesVirtualModule(exampleRoots),
    tsExamplesVirtualModule(tsExampleRoots),
    sbtTestLogsVirtualModule(exampleRoots),
    scalaSourcesVirtualModule(exampleRoots),
    scoverageReportsVirtualModule(exampleRoots),
    tritonConfigVirtualModule(repoRoot),
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'json'],
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['.', '..'],
    },
  },
})
