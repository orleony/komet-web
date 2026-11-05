// Komet: работа без интернета и приём напоминаний.
const CACHE = 'komet-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

// Страница, значки и манифест — сначала из сети (чтобы получать обновления), без сети — из кэша.
// Файлы сборки с хешем в имени (assets/) не меняются — сначала из кэша.
self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  const isPage = req.mode === 'navigate'
  const immutable = url.pathname.includes('/assets/')
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      if (immutable) {
        const hit = await cache.match(req)
        if (hit) return hit
      }
      try {
        // Мимо HTTP-кэша GitHub Pages: свежая версия сразу после публикации
        const res = await fetch(req, isPage ? { cache: 'no-cache' } : undefined)
        if (res.ok && res.type === 'basic') {
          await cache.put(isPage ? './index.html' : req, res.clone())
          if (isPage) event.waitUntil(prune(cache, res.clone()))
        }
        return res
      } catch {
        return (await cache.match(isPage ? './index.html' : req)) ?? Response.error()
      }
    })(),
  )
})

/** Старые файлы сборки, на которые новая страница уже не ссылается, — удаляем */
async function prune(cache, page) {
  const html = await page.text()
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname
    if (path.includes('/assets/') && !html.includes(path.split('/assets/')[1])) await cache.delete(req)
  }
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Komet', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Komet', {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: './#today' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (all.length) {
        all[0].postMessage('open-today')
        return all[0].focus()
      }
      return self.clients.openWindow(event.notification.data?.url || './')
    })(),
  )
})
