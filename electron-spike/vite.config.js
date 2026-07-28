import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Renderer build for Electron (Onda Operator).
 * Exposes NEXT_PUBLIC_* from electron-spike/.env for Firebase client RTDB.
 * Never inject Admin / service-account credentials here.
 */
export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname)
  const env = loadEnv(mode, envDir, ['NEXT_PUBLIC_', 'VITE_'])

  return {
    plugins: [react()],
    root: path.resolve(__dirname, 'renderer-src'),
    base: './',
    envDir,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: {
      // Ensure values from dotenv/.env are available even when not VITE_-prefixed load quirks
      'import.meta.env.NEXT_PUBLIC_FIREBASE_API_KEY': JSON.stringify(
        env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN': JSON.stringify(
        env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID': JSON.stringify(
        env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET': JSON.stringify(
        env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
          process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
          '',
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(
        env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
          process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
          '',
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_APP_ID': JSON.stringify(
        env.NEXT_PUBLIC_FIREBASE_APP_ID || process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL': JSON.stringify(
        env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
          process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
          '',
      ),
    },
    build: {
      outDir: path.resolve(__dirname, 'renderer'),
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  }
})
