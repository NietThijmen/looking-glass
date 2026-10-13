import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Separate process: the scriptable ACP agent used by smoke runs and dev.
          fakeAgent: resolve('src/main/acp/fakeAgent.ts'),
          // Runs agent scripts with Electron's Node without leaking ELECTRON_RUN_AS_NODE.
          nodeBootstrap: resolve('src/main/acp/nodeBootstrap.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads must be a single CommonJS file.
      externalizeDeps: false,
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
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
  },
})
