/** Stable Firebase Storage installer objects — overwrite in place on each new build. */

export const INSTALLER_BUCKET = 'cre8ion-onda.firebasestorage.app'

function storageMediaUrl(objectPath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${INSTALLER_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media`
}

export type DownloadPlatform = 'windows' | 'mac'

export type InstallerConfig = {
  platform: DownloadPlatform
  label: string
  filename: string
  /** When false, /download button stays disabled and success page skips auto-download. */
  available: boolean
  url: string
}

export const INSTALLERS: Record<DownloadPlatform, InstallerConfig> = {
  windows: {
    platform: 'windows',
    label: 'Windows',
    filename: 'OndaOperatorSetup.exe',
    available: true,
    url: storageMediaUrl('installers/OndaOperatorSetup.exe'),
  },
  mac: {
    platform: 'mac',
    label: 'Mac',
    filename: 'OndaOperator.dmg',
    available: false,
    url: storageMediaUrl('installers/OndaOperator.dmg'),
  },
}

export function parsePlatform(raw: string | null | undefined): DownloadPlatform | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (key === 'windows' || key === 'win') return 'windows'
  if (key === 'mac' || key === 'macos' || key === 'osx' || key === 'darwin') return 'mac'
  return null
}
