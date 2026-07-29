/**
 * Re-render build/icon-source.png as a Windows app-icon tile:
 * rounded-square (#0a0a0f / --color-bg) + centered .auth-logo wave mark.
 *
 * Not a permanent workflow dependency — run only when brand CSS changes:
 *   npm install --no-save puppeteer sharp
 *   node scripts/render-icon-source.js
 *   npm install --no-save sharp png-to-ico && node scripts/generate-win-icon.js
 *
 * Login page uses class `auth-logo` (app/globals.css), not Electron's
 * `.op-brand-mark-lg` (solid --color-primary-light).
 *
 * Rounded corners are baked into pixels (Windows does not auto-mask).
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const CANVAS = 1024
const CORNER_RATIO = 0.22
const MARK_RATIO = 0.6
const BG = '#0a0a0f' // --color-bg (login auth-shell base)

async function main() {
  let puppeteer
  let sharp
  try {
    puppeteer = require('puppeteer')
    sharp = require('sharp')
  } catch {
    console.error('Missing deps. Run: npm install --no-save puppeteer sharp')
    process.exit(1)
  }

  const root = path.resolve(__dirname, '..')
  const buildDir = path.join(root, 'build')
  const sourcePng = path.join(buildDir, 'icon-source.png')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --color-primary-light: #7b5bf5;
      --color-secondary: #00d4aa;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 512px;
      height: 512px;
      overflow: hidden;
      background: transparent;
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
    }
    #canvas {
      width: 512px;
      height: 512px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
    }
    /* Exact rules from app/globals.css .auth-logo (login / auth pages) */
    .auth-logo {
      font-size: 280px;
      font-weight: 800;
      font-family: var(--font-sans);
      background: linear-gradient(135deg, var(--color-primary-light), var(--color-secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: -0.02em;
      line-height: 1;
      margin: 0;
    }
  </style>
</head>
<body>
  <div id="canvas"><div class="auth-logo" id="mark">〜</div></div>
</body>
</html>`

  fs.mkdirSync(buildDir, { recursive: true })
  const tmpHtml = path.join(os.tmpdir(), `onda-icon-source-${Date.now()}.html`)
  fs.writeFileSync(tmpHtml, html, 'utf8')

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  })
  const rawPath = path.join(buildDir, '_icon-mark-raw.png')
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 })
    await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle0' })
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    await new Promise((r) => setTimeout(r, 400))
    const el = await page.$('#canvas')
    await el.screenshot({ path: rawPath, omitBackground: true, type: 'png' })
  } finally {
    await browser.close()
    fs.unlinkSync(tmpHtml)
  }

  const markSize = Math.round(CANVAS * MARK_RATIO)
  const markScaled = await sharp(rawPath)
    .trim({ threshold: 5 })
    .resize(markSize, markSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer({ resolveWithObject: true })

  const radius = Math.round(CANVAS * CORNER_RATIO)
  const tileSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <rect width="${CANVAS}" height="${CANVAS}" rx="${radius}" ry="${radius}" fill="${BG}"/>
</svg>`)

  const left = Math.round((CANVAS - markScaled.info.width) / 2)
  const top = Math.round((CANVAS - markScaled.info.height) / 2)

  await sharp(tileSvg)
    .composite([{ input: markScaled.data, left, top }])
    .png()
    .toFile(sourcePng)

  fs.unlinkSync(rawPath)
  console.log(
    `Wrote ${path.relative(root, sourcePng)} ` +
      `(${CANVAS}² tile ${BG}, rx=${radius}/${(CORNER_RATIO * 100).toFixed(0)}%, mark~${MARK_RATIO * 100}%)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
