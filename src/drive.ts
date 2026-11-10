import { db } from './db'
import { emptySnapshot, maxBackupBytes, mergeSnapshots, parseSnapshot } from './model'

export const driveScope = 'https://www.googleapis.com/auth/drive.appdata'
const filename = 'studyvault-v1-'
const api = 'https://www.googleapis.com/drive/v3'
const uploads = 'https://www.googleapis.com/upload/drive/v3'
const maxDevices = 24

type Grant = { access_token?: string; expires_in?: number; scope?: string; error?: string }
type TokenClient = { requestAccessToken(options: { prompt: string }): void }
type GoogleOAuth = {
  initTokenClient(options: {
    client_id: string
    scope: string
    include_granted_scopes: boolean
    callback: (grant: Grant) => void
    error_callback: () => void
  }): TokenClient
  hasGrantedAllScopes(grant: Grant, scope: string): boolean
}
type DriveFile = { id: string; name: string; size?: string; version?: string }
type Listing = { files: DriveFile[]; nextPageToken?: string }
export type DriveSession = { token: string; expiresAt: number }
type SyncReceipt = { device: string; versions: Map<string, string>; uploaded: string }
const receipts = new WeakMap<DriveSession, SyncReceipt>()

function oauth() {
  return (window as Window & { google?: { accounts: { oauth2: GoogleOAuth } } }).google?.accounts.oauth2
}

let loading: Promise<void> | undefined
export function prepareDrive() {
  if (oauth()) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => oauth() ? resolve() : reject(new Error('Google sign-in did not initialise.'))
    script.onerror = () => reject(new Error('Google sign-in could not load. Check your connection and try again.'))
    document.head.append(script)
  }).catch(error => {
    loading = undefined
    throw error
  })
  return loading
}

export function authoriseDrive(clientId: string): Promise<DriveSession> {
  return new Promise((resolve, reject) => {
    const identity = oauth()
    if (!identity) throw new Error('Prepare Google sign-in first.')
    identity.initTokenClient({
      client_id: clientId,
      scope: driveScope,
      include_granted_scopes: false,
      callback(grant) {
        const expiresIn = Number(grant.expires_in)
        if (grant.error || !grant.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0
          || !identity.hasGrantedAllScopes(grant, driveScope)) {
          reject(new Error('Google Drive access was declined or could not be granted.'))
          return
        }
        resolve({ token: grant.access_token, expiresAt: Date.now() + expiresIn * 1000 })
      },
      error_callback() { reject(new Error('Google sign-in did not finish. Check whether your browser blocked the pop-up.')) },
    }).requestAccessToken({ prompt: 'select_account' })
  })
}

export class ExpiredDriveSession extends Error {
  constructor() { super('Your Google Drive session expired. Reconnect to continue.') }
}

async function request(session: DriveSession, url: string, options: RequestInit = {}, allowConflict = false) {
  for (let attempt = 0; ; attempt++) {
    if (Date.now() >= session.expiresAt) throw new ExpiredDriveSession()
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${session.token}`)
    const response = await fetch(url, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => null)
    if (!response) {
      if (attempt >= 3 || !navigator.onLine) throw new Error('Google Drive could not be reached. Check your connection and try again.')
      await backoff(attempt)
      continue
    }
    if (response.ok || (allowConflict && response.status === 409)) return response
    if (response.status === 401) throw new ExpiredDriveSession()
    const details = response.status === 403 ? await response.json().catch(() => null) : null
    const reasons: unknown = details?.error?.errors
    const rateLimited = response.status === 429 || (Array.isArray(reasons) && reasons.some(
      ({ reason }: { reason: string }) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason),
    ))
    if ((!rateLimited && response.status < 500) || attempt >= 3) {
      throw new Error(rateLimited ? 'Google Drive is busy. Wait a moment before syncing again.' : `Google Drive returned HTTP ${response.status}.`)
    }
    const retryAfter = response.headers.get('Retry-After')
    const delay = retryAfter === null ? 0 : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()
    if (delay > 15_000) throw new Error('Google Drive asked for a longer pause. Try again later.')
    await backoff(attempt, delay || 0)
  }
}

function backoff(attempt: number, minimum = 0) {
  return new Promise(resolve => setTimeout(resolve, Math.max(minimum, 1000 * 2 ** attempt + Math.random() * 400)))
}

async function list(session: DriveSession) {
  const result: DriveFile[] = []
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name contains '${filename}'`,
    fields: 'files(id,name,size,version),nextPageToken',
    pageSize: '100',
  })
  for (let page = 0; page < 5; page++) {
    const response = await request(session, `${api}/files?${params}`)
    const { files, nextPageToken } = await response.json() as Listing
    result.push(...files)
    if (result.length > maxDevices) throw new Error('This account has too many StudyVault backups to sync.')
    if (!nextPageToken) return result
    params.set('pageToken', nextPageToken)
  }
  throw new Error('Google Drive could not finish listing the backups. Try again.')
}

async function download(session: DriveSession, file: DriveFile) {
  if (Number(file.size) > maxBackupBytes) throw new Error('A Google Drive backup exceeds the 5 MiB limit.')
  const response = await request(session, `${api}/files/${encodeURIComponent(file.id)}?alt=media`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The Google Drive backup could not be read.')
  const decoder = new TextDecoder()
  let bytes = 0
  let json = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBackupBytes) {
      await reader.cancel()
      throw new Error('A Google Drive backup exceeds the 5 MiB limit.')
    }
    json += decoder.decode(value, { stream: true })
  }
  return parseSnapshot(JSON.parse(json + decoder.decode()))
}

async function create(session: DriveSession, name: string, json: string) {
  const ids = await request(session, `${api}/files/generateIds?count=1&space=appDataFolder`)
  const { ids: [id] } = await ids.json() as { ids: [string] }
  const boundary = `vault_${crypto.randomUUID()}`
  const metadata = JSON.stringify({ id, name, parents: ['appDataFolder'], mimeType: 'application/json' })
  await request(session, `${uploads}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--\r\n`,
  }, true)
}

export async function syncDrive(session: DriveSession) {
  if (!navigator.locks) throw new Error('Google Drive sync requires a browser with Web Locks support.')
  return navigator.locks.request('studyvault-drive-sync', async () => {
    const name = filename + await db.deviceId()
    const files = await list(session)
    const own = files.find(file => file.name === name)
    const receipt = receipts.get(session)
    const previous = receipt?.device === name ? receipt : undefined
    const versions = new Map<string, string>()
    let remote = emptySnapshot
    let uploaded = ''
    for (const file of files) {
      if (file.version) versions.set(file.id, file.version)
      if (file.version && previous?.versions.get(file.id) === file.version) {
        if (file.id === own?.id) uploaded = previous.uploaded
        continue
      }
      const snapshot = await download(session, file)
      if (file.id === own?.id) uploaded = JSON.stringify(mergeSnapshots(emptySnapshot, snapshot))
      remote = mergeSnapshots(remote, snapshot)
    }
    // Merge inside the database transaction so local edits made during the fetch are retained.
    const merged = await db.merge(remote)
    const json = JSON.stringify(merged)
    receipts.set(session, { device: name, versions, uploaded })
    if (uploaded === json || (!merged.subjects.length && !merged.cards.length)) return
    if (new Blob([json]).size > maxBackupBytes) throw new Error('Your vault exceeds the 5 MiB Google Drive backup limit.')
    if (own) {
      const response = await request(session, `${uploads}/files/${encodeURIComponent(own.id)}?uploadType=media&fields=id,version`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json,
      })
      const { version } = await response.json() as { version?: string }
      if (version) {
        versions.set(own.id, version)
        receipts.set(session, { device: name, versions, uploaded: json })
      }
    } else {
      if (files.length >= maxDevices) throw new Error('This account has reached the StudyVault backup device limit.')
      await create(session, name, json)
    }
  })
}
