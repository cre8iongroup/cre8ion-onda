/**
 * Strip AppleDouble (._*) sidecars and extended attributes that make
 * macOS codesign fail with:
 *   "resource fork, Finder information, or similar detritus not allowed"
 *
 * Used as electron-builder afterExtract / afterPack hooks (afterPack runs
 * immediately before codesign) and by clean-mac-build.js.
 */

const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function isDarwin() {
  return process.platform === 'darwin'
}

function runQuiet(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  return result
}

/**
 * Recursively strip codesign-hostile metadata from a directory tree.
 * Safe no-op on non-macOS.
 */
function stripDetritus(targetDir, label = targetDir) {
  if (!isDarwin()) {
    return
  }
  if (!targetDir || !fs.existsSync(targetDir)) {
    return
  }

  const resolved = path.resolve(targetDir)
  console.log(`[mac-detritus] stripping AppleDouble / xattrs: ${label}`)

  // Merge + delete AppleDouble (._*) sidecars. xattr alone does not remove these.
  const dotClean = runQuiet('dot_clean', ['-m', resolved])
  if (dotClean.status !== 0) {
    const err = (dotClean.stderr || dotClean.stdout || '').trim()
    console.warn(
      `[mac-detritus] dot_clean warning (continuing): ${err || `exit ${dotClean.status}`}`
    )
  }

  // Belt-and-suspenders: delete any remaining AppleDouble / Finder junk.
  try {
    execFileSync(
      'find',
      [
        resolved,
        '(',
        '-name',
        '._*',
        '-o',
        '-name',
        '.DS_Store',
        '-o',
        '-name',
        '__MACOSX',
        ')',
        '-print',
        '-delete',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (error) {
    console.warn(
      `[mac-detritus] find cleanup warning (continuing): ${error.message}`
    )
  }

  // Clear extended attributes (FinderInfo, ResourceFork, quarantine, etc.).
  const xattr = runQuiet('xattr', ['-cr', resolved])
  if (xattr.status !== 0) {
    const err = (xattr.stderr || xattr.stdout || '').trim()
    console.warn(
      `[mac-detritus] xattr warning (continuing): ${err || `exit ${xattr.status}`}`
    )
  }
}

/**
 * electron-builder hook entry (afterExtract / afterPack).
 * afterPack runs before doSignAfterPack — critical for Helper (GPU) signing.
 */
async function electronBuilderHook(context) {
  if (!isDarwin()) {
    return
  }
  if (context?.electronPlatformName && context.electronPlatformName !== 'darwin') {
    return
  }
  const appOutDir = context?.appOutDir
  if (!appOutDir) {
    return
  }
  stripDetritus(appOutDir, `appOutDir ${appOutDir}`)
}

module.exports = electronBuilderHook
module.exports.default = electronBuilderHook
module.exports.stripDetritus = stripDetritus
module.exports.afterPack = electronBuilderHook
module.exports.afterExtract = electronBuilderHook
