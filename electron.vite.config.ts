import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const projectRoot = process.cwd()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // The release workflow passes the project's YouTube key from a GitHub secret; never commit it.
    define: {
      __QUADRA_BUILTIN_YOUTUBE_API_KEY__: JSON.stringify(process.env.QUADRA_BUILTIN_YOUTUBE_API_KEY?.trim() ?? ''),
    },
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
        input: {
          preload: resolve(projectRoot, 'electron/preload.ts'),
          'monitor-preload': resolve(projectRoot, 'electron/monitor-preload.ts'),
        },
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
