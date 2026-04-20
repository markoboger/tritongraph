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

const require = createRequire(import.meta.url)
const monacoEditorMod = require('vite-plugin-monaco-editor') as
  | ((opts: { languageWorkers?: string[] }) => import('vite').Plugin)
  | { default: (opts: { languageWorkers?: string[] }) => import('vite').Plugin }
const monacoEditorPlugin =
  typeof monacoEditorMod === 'function' ? monacoEditorMod : (monacoEditorMod as { default: typeof monacoEditorMod }).default

const dirname = path.dirname(fileURLToPath(import.meta.url))
/**
 * Two repo-root example folders:
 *   - `sbt-examples`   : the original tutorial / large-OSS sbt builds (numbered 01-…).
 *   - `scala-examples` : richer Scala source projects that exercise the package-graph parser
 *                        (e.g. `animal-fruit` with nested packages for containment rendering).
 * Both folders contain `<dir>/build.sbt`, so both surface as sbt project tabs as well as package
 * tabs (when their subprojects have `.scala` sources).
 */
const repoRoot = path.resolve(dirname, '..')
const exampleRoots = [
  { name: 'sbt-examples', dir: path.resolve(repoRoot, 'sbt-examples') },
  { name: 'scala-examples', dir: path.resolve(repoRoot, 'scala-examples') },
]

export default defineConfig({
  plugins: [
    vue(),
    sbtExamplesVirtualModule(exampleRoots),
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
