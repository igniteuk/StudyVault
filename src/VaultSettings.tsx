import { useEffect, useState, type ChangeEvent } from 'react'
import { Cloud, Download, HardDrive, Upload } from 'lucide-react'
import { db } from './db'
import { maxBackupBytes, parseSnapshot } from './model'
import type { DriveSession } from './drive'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()

export function VaultSettings({ online }: { online: boolean }) {
  const [drive, setDrive] = useState<typeof import('./drive')>()
  const [session, setSession] = useState<DriveSession>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => {
      setSession(undefined)
      setStatus('Google Drive session expired. Reconnect to continue.')
    }, Math.max(0, session.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await action()
    } catch (cause) {
      if (drive && cause instanceof drive.ExpiredDriveSession) setSession(undefined)
      setError(cause instanceof Error ? cause.message : 'The operation failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function backup() {
    void run(async () => {
      const blob = new Blob([JSON.stringify(await db.snapshot())], { type: 'application/json' })
      if (blob.size > maxBackupBytes) throw new Error('This vault exceeds the 5 MiB portable backup limit.')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'studyvault-backup.json'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus('Backup downloaded.')
    })
  }

  function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    void run(async () => {
      if (file.size > maxBackupBytes) throw new Error('This backup exceeds the 5 MiB limit.')
      await db.merge(parseSnapshot(JSON.parse(await file.text())))
      setStatus('Backup merged into your library.')
    })
  }

  return <>
    <div className="page-heading"><p className="eyebrow">YOUR WORKSPACE</p><h1 tabIndex={-1}>Settings</h1><p>Manage copies of your vault and connect another device.</p></div>
    <div role="status" className={status ? 'message success' : 'visually-hidden'}>{status}</div>
    {error && <p className="message error" role="alert">{error}</p>}
    <div className="settings-grid">
      <section className="panel settings-card">
        <span className="tile-icon fern"><HardDrive size={21} /></span><h2>Local backup</h2>
        <p>Download a copy of your library and review progress. Importing merges the selected backup with this vault and keeps the newest version of each item.</p>
        <div className="actions">
          <button className="secondary" disabled={busy} onClick={backup}><Download size={17} /> Export backup</button>
          <label className="file-button secondary"><Upload size={17} /> Import backup
            <input type="file" aria-label="Import backup" accept=".json,application/json" disabled={busy} onChange={importBackup} />
          </label>
        </div>
      </section>
      <section className="panel settings-card">
        <span className="tile-icon iris"><Cloud size={21} /></span><h2>Google Drive</h2>
        {!clientId ? <><span className="pill">Unavailable</span><p>Google Drive sync is unavailable on this build. Your library and local backups work offline.</p></>
          : <>
            <span className="pill">{session ? 'Connected' : 'Optional'}</span>
            <p>Sync on demand with your chosen Google account. Sync now sends this browser’s library and merges private backups from that account. Leaving Settings disconnects this session.</p>
            {!online && <p>Reconnect to the internet to use Google Drive.</p>}
            <div className="actions">
              {session && drive ? <>
                <button className="primary" disabled={busy || !online} onClick={() => void run(async () => {
                  await drive.syncDrive(session)
                  setStatus('Google Drive sync complete.')
                })}>Sync now</button>
                <button className="secondary" disabled={busy} onClick={() => { setSession(undefined); setStatus('Google Drive disconnected.'); setError('') }}>Disconnect</button>
              </> : drive ? <button className="primary" disabled={busy || !online} onClick={() => void run(async () => {
                setSession(await drive.authoriseDrive(clientId))
                setStatus('Google Drive connected. Choose Sync now to transfer data.')
              })}>Connect Google Drive</button> : <button className="secondary" disabled={busy || !online} onClick={() => void run(async () => {
                const module = await import('./drive')
                await module.prepareDrive()
                setDrive(module)
                setStatus('Google sign-in is ready.')
              })}>Set up Google Drive</button>}
            </div>
          </>}
        <a className="text-link" href="/privacy/">Privacy policy</a>
      </section>
    </div>
  </>
}
