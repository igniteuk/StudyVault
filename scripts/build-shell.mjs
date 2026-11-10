import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { loadEnv } from 'vite'

const assets = (await readdir('dist/assets')).map(name => `/assets/${name}`)
const shell = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
  '/privacy/', '/privacy-base.css', ...assets.sort()]
const hash = createHash('sha256')
hash.update(await readFile(new URL(import.meta.url)))
hash.update(await readFile('dist/_headers'))
for (const asset of shell) {
  hash.update(asset)
  hash.update(await readFile(`dist${asset}${asset.endsWith('/') ? 'index.html' : ''}`))
}
const version = hash.digest('hex').slice(0, 20)
const client = loadEnv('production', process.cwd(), 'VITE_GOOGLE_CLIENT_ID').VITE_GOOGLE_CLIENT_ID?.trim()
await writeFile('dist/build-info.json', JSON.stringify({
  version, shell,
  driveClient: client ? createHash('sha256').update(client).digest('hex') : null,
}) + '\n')
await writeFile('dist/sw.js', `const CACHE = 'studyvault-shell-${version}';
const SHELL = ${JSON.stringify(shell)};
const ROUTES = new Set(['/', '/library', '/review', '/settings']);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload', redirect: 'error' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('studyvault-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && ROUTES.has(url.pathname.replace(/\\/$/, '') || '/')) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/')).then(hit => hit || fetch(request)));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(hit => hit || fetch(request)));
  }
});
`)
