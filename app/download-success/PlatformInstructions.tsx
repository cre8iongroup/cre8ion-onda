import type { DownloadPlatform } from '@/app/download/installers'

/**
 * Platform-specific install steps for /download-success.
 * Keep all OS-specific copy here — page shell should only switch on platform.
 */

export function PlatformInstructions({ platform }: { platform: DownloadPlatform | null }) {
  if (platform === 'windows') return <WindowsInstructions />
  if (platform === 'mac') return <MacInstructions />
  return <GenericInstructions />
}

function WindowsInstructions() {
  return (
    <ol className="dl-steps">
      <li>
        <strong>Find the download.</strong> Your browser should save{' '}
        <code>OndaOperatorSetup.exe</code> to your Downloads folder (or wherever you save files).
      </li>
      <li>
        <strong>Run the installer.</strong> Double-click <code>OndaOperatorSetup.exe</code> to start
        setup.
      </li>
      <li>
        <strong>Expect SmartScreen.</strong> Windows will likely show{' '}
        <em>“Windows protected your PC”</em>. That is expected for this internal unsigned build — it
        is not a virus warning from Microsoft Defender scanning the file contents.
      </li>
      <li>
        <strong>Bypass SmartScreen.</strong> Click <strong>More info</strong>, then{' '}
        <strong>Run anyway</strong>.
      </li>
      <li>
        <strong>Finish setup.</strong> Follow the installer prompts, then launch{' '}
        <strong>Onda Operator</strong> from the Start menu.
      </li>
    </ol>
  )
}

function MacInstructions() {
  return (
    <ol className="dl-steps">
      <li>
        <strong>Find the download.</strong> Your browser should save{' '}
        <code>OndaOperatorSetup.dmg</code> to your Downloads folder.
      </li>
      <li>
        <strong>Open the disk image.</strong> Double-click <code>OndaOperatorSetup.dmg</code>, then drag{' '}
        <strong>Onda Operator</strong> into <strong>Applications</strong>.
      </li>
      <li>
        <strong>Expect a security warning.</strong> macOS will likely block the app on first launch
        since it isn&apos;t notarized. That is expected for this internal unsigned build — not a sign
        of a broken download. Try one of these:
        <ul className="dl-steps-alt">
          <li>
            Right-click (or Control-click) the app in <strong>Applications</strong> →{' '}
            <strong>Open</strong> → <strong>Open</strong>, if that option appears.
          </li>
          <li>
            If that doesn&apos;t work: open <strong>System Settings</strong> (or{' '}
            <strong>System Preferences</strong> on older macOS) →{' '}
            <strong>Privacy &amp; Security</strong> → look for a message about the app being
            blocked, and click <strong>Open Anyway</strong>.
          </li>
        </ul>
      </li>
      <li>
        <strong>Launch normally.</strong> After you approve it once, you can open Onda Operator from
        Applications like any other app.
      </li>
    </ol>
  )
}

function GenericInstructions() {
  return (
    <div className="dl-generic">
      <p>
        Your download should start shortly. After it finishes, open the installer and follow the
        on-screen prompts.
      </p>
      <p className="dl-note">
        Windows users may see a SmartScreen warning for this unsigned internal build — choose{' '}
        <strong>More info</strong> → <strong>Run anyway</strong>. Mac users on recent macOS may need{' '}
        <strong>System Settings → Privacy &amp; Security → Open Anyway</strong> after the first
        blocked launch.
      </p>
      <p className="dl-note">
        Prefer platform-specific steps? Use the Windows or Mac button on the{' '}
        <a href="/download">download page</a> when available.
      </p>
    </div>
  )
}
