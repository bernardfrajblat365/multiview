import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const projectRoot = process.cwd()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(projectRoot, 'electron/main.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(projectRoot, 'electron/preload.ts'),
      },
    },
  },
  renderer: {
    root: projectRoot,
    server: {
      host: '0.0.0.0',
      port: 43123,
      strictPort: true,
    },
    preview: {
      host: '0.0.0.0',
      port: 43123,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: resolve(projectRoot, 'index.html'),
      },
    },
  },
})
