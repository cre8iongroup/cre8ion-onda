import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Prefer values baked by scripts/inject-build-config.js (.env.build → generated JSON).
 * Fall back to Vite loadEnv (.env / mode files) for ad-hoc local renderer builds.
 * Never inject Admin / service-account credentials here.
 */
function loadOperatorPublicEnv(mode) {
  const generatedPath = path.resolve(__dirname, 'lib/buildConfig.generated.json')
  if (fs.existsSync(generatedPath)) {
    try {
      return JSON.parse(fs.readFileSync(generatedPath, 'utf8'))
    } catch (err) {
      console.warn('[vite] failed to read buildConfig.generated.json:', err.message)
    }
  }
  return loadEnv(mode, path.resolve(__dirname), ['NEXT_PUBLIC_', 'VITE_'])
}

export default defineConfig(({ mode }) => {
  const env = loadOperatorPublicEnv(mode)
  const envDir = path.resolve(__dirname)

  function pub(key) {
    return env[key] || process.env[key] || ''
  }

  return {
    plugins: [react()],
    root: path.resolve(__dirname, 'renderer-src'),
    base: './',
    envDir,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: {
      'import.meta.env.NEXT_PUBLIC_FIREBASE_API_KEY': JSON.stringify(pub('NEXT_PUBLIC_FIREBASE_API_KEY')),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN': JSON.stringify(
        pub('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID': JSON.stringify(
        pub('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET': JSON.stringify(
        pub('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(
        pub('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
      ),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_APP_ID': JSON.stringify(pub('NEXT_PUBLIC_FIREBASE_APP_ID')),
      'import.meta.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL': JSON.stringify(
        pub('NEXT_PUBLIC_FIREBASE_DATABASE_URL'),
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
      fs: {
        // Shared WhyOndaModal lives at repo-root /components
        allow: [path.resolve(__dirname, '..')],
      },
    },
  }
})
