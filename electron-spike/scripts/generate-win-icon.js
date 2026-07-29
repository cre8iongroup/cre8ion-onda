/**
 * Generate electron-spike/build/icon.ico from the Onda welcome wave mark.
 *
 * Source mark: Unicode WAVE DASH "〜" (U+301C) rendered inline in
 * renderer-src/App.jsx (.op-brand-mark / .op-brand-mark-lg) with
 * color --color-primary-light (#7b5bf5). There is no separate SVG/PNG asset.
 *
 * Usage (from electron-spike/):
 *   npm install --no-save sharp png-to-ico
 *   node scripts/generate-win-icon.js
 */

const fs = require('fs')
const path = require('path')

async function main() {
  let sharp
  let pngToIco
  try {
    sharp = require('sharp')
    pngToIco = require('png-to-ico').default || require('png-to-ico')
  } catch {
    console.error(
      'Missing deps. Run: npm install --no-save sharp png-to-ico\n' +
        'Then re-run: node scripts/generate-win-icon.js',
    )
    process.exit(1)
  }

  const root = path.resolve(__dirname, '..')
  const buildDir = path.join(root, 'build')
  const tmpDir = path.join(buildDir, '_icon-png')
  const SIZES = [16, 32, 48, 128, 256]
  const COLOR = '#7b5bf5'

  function waveSvg(size) {
    const fontSize = Math.round(size * 0.72)
    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <text
    x="50%"
    y="50%"
    text-anchor="middle"
    dominant-baseline="central"
    font-family="Segoe UI, Arial, Helvetica, sans-serif"
    font-size="${fontSize}"
    font-weight="600"
    fill="${COLOR}"
  >〜</text>
</svg>`)
  }

  fs.mkdirSync(tmpDir, { recursive: true })
  const pngPaths = []
  for (const size of SIZES) {
    const out = path.join(tmpDir, `icon-${size}.png`)
    await sharp(waveSvg(size))
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out)
    pngPaths.push(out)
  }

  const icoPath = path.join(buildDir, 'icon.ico')
  const icoBuf = await pngToIco(pngPaths)
  fs.writeFileSync(icoPath, icoBuf)

  const count = icoBuf.readUInt16LE(4)
  console.log(`Wrote ${path.relative(root, icoPath)} (${icoBuf.length} bytes, ${count} sizes)`)
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16
    const w = icoBuf[off] === 0 ? 256 : icoBuf[off]
    const h = icoBuf[off + 1] === 0 ? 256 : icoBuf[off + 1]
    console.log(`  ${w}x${h}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
