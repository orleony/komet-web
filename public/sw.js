// Komet: работа без интернета и приём напоминаний.
const CACHE = 'komet-v3'

// Установка: свежая страница и все файлы её сборки — чтобы первый же запуск без сети не был белым экраном
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(['./manifest.webmanifest', './icons/icon-192.png'])
      const page = await fetch('./index.html', { cache: 'no-cache' })
      if (!page.ok) throw new Error('index.html')
      const html = await page.clone().text()
      const assets = [...new Set(html.match(/\.?\/?assets\/[^"'\s)]+/g) ?? [])].map((a) => './' + a.replace(/^\.?\//, ''))
      await cache.addAll(assets)
      await cache.put('./index.html', page)
    })(),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const cache = await caches.open(CACHE)
      for (const k of keys.filter((k) => k !== CACHE)) {
        // Из старого кэша забираем то, чего нет в новом (на всякий случай), и удаляем его
        const old = await caches.open(k)
        for (const req of await old.keys()) {
          if (!(await cache.match(req))) {
            const res = await old.match(req)
            if (res) await cache.put(req, res)
          }
        }
        await caches.delete(k)
      }
      await self.clients.claim()
    })(),
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
