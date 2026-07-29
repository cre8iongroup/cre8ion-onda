/**
 * Bake Onda Operator config from a local gitignored env file into
 * lib/buildConfig.generated.json for packaging / renderer define.
 *
 * Source (first match):
 *   --packaged  →  .env.build  (required)
 *   default     →  .env.build if present, else .env
 *
 * Never commit .env.build or buildConfig.generated.json.
 */

const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const root = path.resolve(__dirname, '..')
const outPath = path.join(root, 'lib', 'buildConfig.generated.json')

const KEYS = [
  'RECALL_API_KEY',
  'RECALL_REGION',
  'RECALL_WEBHOOK_SECRET',
  'ONDA_API_BASE',
  'ONDA_WEBHOOK_URL',
  'ONDA_PUBLIC_WEBHOOK_BASE',
  'ONDA_LOCAL_FORWARDER_ENABLED',
  'SESSION_ID',
  'LANGUAGE_CODE',
  'DEEPGRAM_STREAMING_PRESET',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_DATABASE_URL',
]

const REQUIRED_PACKAGED = [
  'RECALL_API_KEY',
  'RECALL_REGION',
  'RECALL_WEBHOOK_SECRET',
  'ONDA_API_BASE',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_DATABASE_URL',
]

function parseArgs(argv) {
  return {
    packaged: argv.includes('--packaged'),
  }
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null
  return dotenv.parse(fs.readFileSync(filePath, 'utf8'))
}

function isLocalhostUrl(value) {
  try {
    const u = new URL(String(value))
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function pickSource({ packaged }) {
  const buildPath = path.join(root, '.env.build')
  const envPath = path.join(root, '.env')

  if (packaged) {
    if (!fs.existsSync(buildPath)) {
      console.error(
        '[inject-build-config] Packaged builds require electron-spike/.env.build\n' +
          '  Copy .env.build.example → .env.build and fill production values.\n' +
          '  Do not use localhost for ONDA_API_BASE / ONDA_WEBHOOK_URL.',
      )
      process.exit(1)
    }
    return { filePath: buildPath, parsed: readEnvFile(buildPath) }
  }

  if (fs.existsSync(buildPath)) {
    return { filePath: buildPath, parsed: readEnvFile(buildPath) }
  }
  if (fs.existsSync(envPath)) {
    return { filePath: envPath, parsed: readEnvFile(envPath) }
  }

  console.error(
    '[inject-build-config] No .env.build or .env found in electron-spike/.\n' +
      '  For local: cp .env.example .env\n' +
      '  For installer: cp .env.build.example .env.build',
  )
  process.exit(1)
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { filePath, parsed } = pickSource(opts)
  const config = {}

  for (const key of KEYS) {
    const raw = parsed[key]
    config[key] = raw === undefined || raw === null ? '' : String(raw).trim()
  }

  // Production installers must talk to cre8ion-onda.app, not a local Next server.
  if (opts.packaged) {
    const missing = REQUIRED_PACKAGED.filter((k) => !config[k])
    if (missing.length) {
      console.error(
        `[inject-build-config] Missing required keys in ${path.basename(filePath)}:\n  - ${missing.join('\n  - ')}`,
      )
      process.exit(1)
    }
    if (isLocalhostUrl(config.ONDA_API_BASE)) {
      console.error(
        `[inject-build-config] ONDA_API_BASE must not be localhost for packaged builds (got ${config.ONDA_API_BASE}).\n` +
          '  Use https://cre8ion-onda.app',
      )
      process.exit(1)
    }
    if (config.ONDA_WEBHOOK_URL && isLocalhostUrl(config.ONDA_WEBHOOK_URL)) {
      console.error(
        `[inject-build-config] ONDA_WEBHOOK_URL must not be localhost for packaged builds (got ${config.ONDA_WEBHOOK_URL}).\n` +
          '  Use https://cre8ion-onda.app',
      )
      process.exit(1)
    }
    // Distributed machines must not run the synthetic local webhook forwarder.
    config.ONDA_LOCAL_FORWARDER_ENABLED = 'false'
  }

  // Defaults for optional fields when blank
  if (!config.RECALL_REGION) config.RECALL_REGION = 'us-west-2'
  if (!config.LANGUAGE_CODE) config.LANGUAGE_CODE = 'en'
  if (!config.ONDA_API_BASE) config.ONDA_API_BASE = opts.packaged ? 'https://cre8ion-onda.app' : 'http://localhost:3000'
  if (!config.ONDA_PUBLIC_WEBHOOK_BASE && config.ONDA_WEBHOOK_URL) {
    config.ONDA_PUBLIC_WEBHOOK_BASE = config.ONDA_WEBHOOK_URL
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  console.log(
    `[inject-build-config] Wrote ${path.relative(root, outPath)} from ${path.basename(filePath)}` +
      (opts.packaged ? ' (packaged)' : ''),
  )
}

main()
