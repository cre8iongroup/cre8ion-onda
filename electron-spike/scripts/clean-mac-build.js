/**
 * Pre-flight cleanup for Mac packaging.
 *
 * Clears Electron's zip cache (separate from electron-builder's cache),
 * removes AppleDouble sidecars from the project tree, and deletes dist/
 * so the next electron-builder --mac run starts clean.
 *
 * Run via: npm run clean:mac  (also chained automatically by build:mac)
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { stripDetritus } = require('./strip-mac-detritus')

const root = path.resolve(__dirname, '..')
const distDir = path.join(root, 'dist')
const electronCacheDir = path.join(os.homedir(), 'Library', 'Caches', 'electron')

function rmrf(target) {
  if (!fs.existsSync(target)) {
    console.log(`[clean:mac] skip (missing): ${target}`)
    return
  }
  fs.rmSync(target, { recursive: true, force: true })
  console.log(`[clean:mac] removed: ${target}`)
}

function main() {
  console.log('[clean:mac] preparing a clean Mac packaging tree')

  // Electron downloads its runtime zip here (@electron/get). Contaminated
  // extracts / AppleDouble leftovers in this cache survive clearing
  // ~/Library/Caches/electron-builder alone.
  if (process.platform === 'darwin') {
    rmrf(electronCacheDir)
  } else {
    console.log(
      `[clean:mac] skip electron cache clear on ${process.platform} (macOS-only path)`
    )
  }

  // Remove AppleDouble + xattrs from the project before packaging copies them.
  stripDetritus(root, `project ${root}`)

  rmrf(distDir)
  console.log('[clean:mac] done')
}

main()
