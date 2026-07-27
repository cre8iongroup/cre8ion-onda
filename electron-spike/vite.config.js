import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Renderer build for Electron.
 * Output lands in `renderer/` so existing main.js loadFile(.../renderer/index.html)
 * keeps working — do not change main.js / preload.js for Stage 1.
 */
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'renderer-src'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
