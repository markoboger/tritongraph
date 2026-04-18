import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { sbtExamplesVirtualModule } from './vite-plugin-sbt-examples'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const sbtExamplesDir = path.resolve(dirname, '../sbt-examples')

export default defineConfig({
  plugins: [vue(), sbtExamplesVirtualModule(sbtExamplesDir)],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['.', '..'],
    },
  },
})
