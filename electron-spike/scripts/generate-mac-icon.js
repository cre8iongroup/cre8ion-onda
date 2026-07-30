/**
 * Generate electron-spike/build/icon.icns from build/icon-source.png.
 *
 * Apple HIG (current): provide a full square; macOS applies the squircle mask.
 * icon-source.png is the Windows tile (rounded corners + transparent outside).
 * We flatten transparent corners to #0a0a0f so the ICNS is a solid square —
 * avoiding double-rounded corners when the system masks it.
 *
 * Uses png2icons (Node, works on Linux/macOS/Windows — no iconutil required).
 *
 * Usage (from electron-spike/):
 *   npm install --no-save sharp png2icons
 *   node scripts/generate-mac-icon.js
 */

const fs = require('fs')
const path = require('path')

async function main() {
  let sharp
  let png2icons
  try {
    sharp = require('sharp')
    png2icons = require('png2icons')
  } catch {
    console.error(
      'Missing deps. Run: npm install --no-save sharp png2icons\n' +
        'Then re-run: node scripts/generate-mac-icon.js',
    )
    process.exit(1)
  }

  const root = path.resolve(__dirname, '..')
  const buildDir = path.join(root, 'build')
  const sourcePng = path.join(buildDir, 'icon-source.png')
  const icnsPath = path.join(buildDir, 'icon.icns')

  if (!fs.existsSync(sourcePng)) {
    console.error(`Missing ${path.relative(root, sourcePng)}`)
    process.exit(1)
  }

  // Full square: fill transparent corners with the tile background (#0a0a0f)
  const squarePng = await sharp(sourcePng)
    .ensureAlpha()
    .flatten({ background: { r: 0x0a, g: 0x0a, b: 0x0f } })
    .resize(1024, 1024, { fit: 'fill' })
    .png()
    .toBuffer()

  const icns = png2icons.createICNS(squarePng, png2icons.BICUBIC, 0)
  if (!icns) {
    console.error('png2icons.createICNS returned empty result')
    process.exit(1)
  }

  fs.writeFileSync(icnsPath, icns)
  console.log(
    `Wrote ${path.relative(root, icnsPath)} (${icns.length} bytes) from icon-source.png ` +
      '(flattened to full #0a0a0f square for macOS system masking)',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
