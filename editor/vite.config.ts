import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { sbtExamplesVirtualModule } from './vite-plugin-sbt-examples'

const require = createRequire(import.meta.url)
const monacoEditorMod = require('vite-plugin-monaco-editor') as
  | ((opts: { languageWorkers?: string[] }) => import('vite').Plugin)
  | { default: (opts: { languageWorkers?: string[] }) => import('vite').Plugin }
const monacoEditorPlugin =
  typeof monacoEditorMod === 'function' ? monacoEditorMod : (monacoEditorMod as { default: typeof monacoEditorMod }).default

const dirname = path.dirname(fileURLToPath(import.meta.url))
const sbtExamplesDir = path.resolve(dirname, '../sbt-examples')

export default defineConfig({
  plugins: [
    vue(),
    sbtExamplesVirtualModule(sbtExamplesDir),
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
