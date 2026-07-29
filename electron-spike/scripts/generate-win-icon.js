/**
 * Build electron-spike/build/icon.ico from the CSS-rendered source PNG.
 *
 * Source of truth for the mark styling: login page `.auth-logo` in
 * app/globals.css (NOT Electron `.op-brand-mark-lg`, which is solid purple).
 * Login markup: <div className="auth-logo">〜 Onda</div>
 *
 * High-res source: build/icon-source.png (purple→teal gradient 〜 on
 * transparent). Re-render that PNG with a headless browser if CSS changes —
 * see scripts/render-icon-source.js (optional; needs puppeteer via
 * `npm install --no-save puppeteer`).
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
  const sourcePng = path.join(buildDir, 'icon-source.png')
  const tmpDir = path.join(buildDir, '_icon-png')
  const icoPath = path.join(buildDir, 'icon.ico')
  const SIZES = [16, 32, 48, 128, 256]

  if (!fs.existsSync(sourcePng)) {
    console.error(
      `Missing ${path.relative(root, sourcePng)}.\n` +
        'Re-render it first: npm install --no-save puppeteer && node scripts/render-icon-source.js',
    )
    process.exit(1)
  }

  fs.mkdirSync(tmpDir, { recursive: true })
  const pngPaths = []
  for (const size of SIZES) {
    const out = path.join(tmpDir, `icon-${size}.png`)
    await sharp(sourcePng)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(out)
    pngPaths.push(out)
  }

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
