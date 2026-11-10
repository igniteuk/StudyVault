import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/db'
import { driveScope, authoriseDrive, syncDrive, ExpiredDriveSession } from '../../src/drive'

beforeEach(async () => {
  await db.delete()
  await db.open()
  vi.stubGlobal('navigator', { onLine: true, locks: { request: (_: string, action: () => unknown) => action() } })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function session() {
  return { token: 'mock-token', expiresAt: Date.now() + 60_000 }
}

it('requests only the private app data scope and rejects a missing grant', async () => {
  const hasGrantedAllScopes = vi.fn().mockReturnValue(false)
  const initTokenClient = vi.fn(({ callback }) => ({
    requestAccessToken: () => callback({ access_token: 'mock', expires_in: 3600 }),
  }))
  vi.stubGlobal('window', { google: { accounts: { oauth2: { hasGrantedAllScopes, initTokenClient } } } })
  await expect(authoriseDrive('public-client')).rejects.toThrow('access was declined')
  expect(initTokenClient).toHaveBeenCalledWith(expect.objectContaining({ scope: driveScope, include_granted_scopes: false }))
})

it('stops on an expired or revoked session', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', fetch)
  await expect(syncDrive({ token: 'expired', expiresAt: 0 })).rejects.toBeInstanceOf(ExpiredDriveSession)
  expect(fetch).not.toHaveBeenCalled()
  await expect(syncDrive(session())).rejects.toBeInstanceOf(ExpiredDriveSession)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('leaves IndexedDB unchanged when a remote backup fails validation', async () => {
  await db.saveSubject('Before', 'fern')
  const before = await db.snapshot()
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ files: [{ id: 'file', name: 'studyvault-v1-device' }] }))
    .mockResolvedValueOnce(Response.json({ version: 999 }))
  vi.stubGlobal('fetch', fetch)
  await expect(syncDrive(session())).rejects.toThrow('invalid')
  expect(await db.snapshot()).toEqual(before)
})

it('backs off and retries a transport failure with the same pre-generated upload ID', async () => {
  await db.saveSubject('Biology', 'fern')
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ files: [] }))
    .mockResolvedValueOnce(Response.json({ ids: ['reserved-id'] }))
    .mockRejectedValueOnce(new TypeError('Lost response'))
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
  vi.stubGlobal('fetch', fetch)
  await syncDrive(session())
  expect(fetch.mock.calls[0][0]).toContain('spaces=appDataFolder')
  expect(fetch.mock.calls[2][1].body).toContain('"id":"reserved-id"')
  expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[3][1].body)
})

it('backs off after quota throttling and avoids uploading an unchanged device snapshot', async () => {
  await db.saveSubject('Biology', 'fern')
  const device = await db.deviceId()
  const listing = { files: [{ id: 'own', name: 'studyvault-v1-' + device, version: '1' }] }
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockResolvedValueOnce(Response.json(listing))
    .mockResolvedValueOnce(Response.json(await db.snapshot()))
    .mockResolvedValueOnce(Response.json(listing))
  vi.stubGlobal('fetch', fetch)
  const active = session()
  await syncDrive(active)
  await syncDrive(active)
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(fetch.mock.calls[3][0]).toContain('spaces=appDataFolder')
})
