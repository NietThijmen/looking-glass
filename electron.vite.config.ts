import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

/**
 * `--mode smoke` builds into out-smoke/ so a smoke run doesn't replace out/ under a running
 * `pnpm dev`. Set here with absolute paths: `--outDir` resolves the renderer's folder
 * against its `root` (src/renderer), not the project.
 */
const outDir = (mode: string, part: string): string | undefined =>
  mode === 'smoke' ? resolve('out-smoke', part) : undefined

export default defineConfig(({ mode }) => ({
  main: {
    build: {
      // Bundle workspace packages. Their exports point at TypeScript source, which
      // Node cannot load if electron-vite leaves the dependency external.
      externalizeDeps: {
        exclude: [
          '@lookingglass/shared',
          '@lookingglass/workspace',
          '@lookingglass/review',
          '@lookingglass/acp',
          '@lookingglass/forge',
        ],
      },
      outDir: outDir(mode, 'main'),
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Separate process: the scriptable ACP agent used by smoke runs and dev.
          fakeAgent: resolve('packages/acp/src/fakeAgent.ts'),
          // Runs agent scripts with Electron's Node without leaking ELECTRON_RUN_AS_NODE.
          nodeBootstrap: resolve('packages/acp/src/nodeBootstrap.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads must be a single CommonJS file.
      externalizeDeps: false,
      outDir: outDir(mode, 'preload'),
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      outDir: outDir(mode, 'renderer'),
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
  },
}))
