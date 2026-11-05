// Сервер напоминаний Komet на Cloudflare Workers.
// Телефон присылает расписание напоминаний на неделю вперёд; раз в минуту сервер рассылает те, чьё время пришло.
// Хранится только то, что нужно для напоминаний: подписка push, время, заголовок и текст.
import { sendPush } from './webpush'
import type { Subscription } from './webpush'

interface D1Result<T> { results: T[] }
interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
  run(): Promise<unknown>
}
interface D1Database {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown>
}

export interface Env {
  DB: D1Database
  VAPID_PUBLIC: string
  VAPID_PRIVATE: string
  VAPID_SUBJECT: string
}

interface Reminder { at: number; title: string; body: string; tag: string }

const MAX_REMINDERS = 120
const MAX_BODY = 64 * 1024
const MAX_DEVICES = 5000

/** Тело запроса — не больше 64 КБ */
async function readJSON(request: Request): Promise<any> {
  const text = await request.text()
  if (text.length > MAX_BODY) throw new HttpError(413, 'too large')
  try {
    return JSON.parse(text || '{}')
  } catch {
    throw new HttpError(400, 'bad json')
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Храним из подписки только то, что нужно для отправки */
const slim = (s: Subscription) => JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } })

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Сервисы push браузеров: Apple, Google (Chrome/Android), Mozilla, Microsoft */
const pushHosts = [/^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/]

function validSubscription(s: any): s is Subscription {
  if (!s || typeof s.endpoint !== 'string' || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') return false
  if (s.endpoint.length > 1000 || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return false
  try {
    const url = new URL(s.endpoint)
    return url.protocol === 'https:' && pushHosts.some((h) => h.test(url.hostname))
  } catch {
    return false
  }
}

function cleanReminders(list: unknown): Reminder[] {
  if (!Array.isArray(list)) return []
  const now = Math.floor(Date.now() / 1000)
  return list
    .filter((r) => r && Number.isFinite(r.at) && r.at > now && typeof r.title === 'string')
    .slice(0, MAX_REMINDERS)
    .map((r) => ({
      at: Math.floor(r.at),
      title: String(r.title).slice(0, 200),
      body: String(r.body ?? '').slice(0, 400),
      tag: String(r.tag ?? '').slice(0, 100),
    }))
}

async function authorized(env: Env, id: string, token: unknown): Promise<boolean> {
  if (typeof token !== 'string') return false
  const row = await env.DB.prepare('SELECT token_hash FROM devices WHERE id = ?').bind(id).first<{ token_hash: string }>()
  return !!row && row.token_hash === (await sha256(token))
}

async function replaceReminders(env: Env, id: string, reminders: Reminder[]) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reminders WHERE device = ?').bind(id),
    ...reminders.map((r) => env.DB.prepare('INSERT INTO reminders (device, at, title, body, tag) VALUES (?, ?, ?, ?, ?)').bind(id, r.at, r.title, r.body, r.tag)),
  ])
}

const vapid = (env: Env) => ({ publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE, subject: env.VAPID_SUBJECT })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    try {
      // Открытый ключ для подписки в браузере
      if (request.method === 'GET' && parts[0] === 'vapid') return json({ publicKey: env.VAPID_PUBLIC })

      // Новое устройство: возвращаем id и секрет, которым оно потом подписывает запросы
      if (request.method === 'POST' && parts[0] === 'devices' && parts.length === 1) {
        const body: any = await readJSON(request)
        if (!validSubscription(body.subscription)) return json({ error: 'bad subscription' }, 400)
        // Точное совпадение адреса (не LIKE: там «%» и «_» — подстановочные знаки)
        const old = await env.DB.prepare("SELECT id FROM devices WHERE json_extract(subscription, '$.endpoint') = ?").bind(body.subscription.endpoint).all<{ id: string }>()
        if (!old.results.length) {
          const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices').first<{ n: number }>()
          if ((count?.n ?? 0) >= MAX_DEVICES) return json({ error: 'busy' }, 503)
        }
        if (old.results.length) {
          await env.DB.batch(old.results.flatMap((d) => [
            env.DB.prepare('DELETE FROM reminders WHERE device = ?').bind(d.id),
            env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(d.id),
          ]))
        }
        const id = crypto.randomUUID()
        const token = crypto.randomUUID() + crypto.randomUUID()
        await env.DB.prepare('INSERT INTO devices (id, token_hash, subscription, updated) VALUES (?, ?, ?, ?)')
          .bind(id, await sha256(token), slim(body.subscription), Date.now()).run()
        await replaceReminders(env, id, cleanReminders(body.reminders))
        return json({ id, token })
      }

      if (parts[0] === 'devices' && parts[1]) {
        const id = parts[1]
        const body: any = request.method === 'DELETE' || request.method === 'PUT' || request.method === 'POST' ? await readJSON(request) : {}
        if (!(await authorized(env, id, body.token))) return json({ error: 'unknown device' }, 404)

        // Новое расписание напоминаний (и, если сменилась, подписка)
        if (request.method === 'PUT' && parts.length === 2) {
          if (body.subscription && validSubscription(body.subscription)) {
            await env.DB.prepare('UPDATE devices SET subscription = ?, updated = ? WHERE id = ?').bind(slim(body.subscription), Date.now(), id).run()
          } else {
            await env.DB.prepare('UPDATE devices SET updated = ? WHERE id = ?').bind(Date.now(), id).run()
          }
          const reminders = cleanReminders(body.reminders)
          await replaceReminders(env, id, reminders)
          return json({ ok: true, count: reminders.length })
        }

        // Проверка: прислать уведомление прямо сейчас
        if (request.method === 'POST' && parts[2] === 'test') {
          const row = await env.DB.prepare('SELECT subscription FROM devices WHERE id = ?').bind(id).first<{ subscription: string }>()
          const result = await sendPush(JSON.parse(row!.subscription), { title: 'Komet', body: 'Напоминания работают ☄️', tag: 'test' }, vapid(env))
          return json(result, result.status < 300 ? 200 : 502)
        }

        if (request.method === 'DELETE' && parts.length === 2) {
          await env.DB.batch([
            env.DB.prepare('DELETE FROM reminders WHERE device = ?').bind(id),
            env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id),
          ])
          return json({ ok: true })
        }
      }
      return json({ error: 'not found' }, 404)
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status)
      return json({ error: String(e) }, 500)
    }
  },

  /** Раз в минуту: рассылаем всё, чьё время пришло; совсем старое (больше 15 минут) — просто выбрасываем. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    // Забираем (удаляем с возвратом) — следующая рассылка этих напоминаний уже не увидит
    const due = await env.DB.prepare(
      'DELETE FROM reminders WHERE rowid IN (SELECT rowid FROM reminders WHERE at <= ? ORDER BY at LIMIT 500) RETURNING device, at, title, body, tag',
    ).bind(now).all<{ device: string; at: number; title: string; body: string; tag: string }>()

    const subs = new Map<string, Subscription | null>()
    const gone = new Set<string>()
    // Временный сбой (сеть, 429, 5xx) — вернём напоминание, следующая минута попробует снова
    const retry: typeof due.results = []
    for (const r of due.results) {
      if (gone.has(r.device) || r.at < now - 15 * 60) continue
      if (!subs.has(r.device)) {
        const row = await env.DB.prepare('SELECT subscription FROM devices WHERE id = ?').bind(r.device).first<{ subscription: string }>()
        subs.set(r.device, row ? JSON.parse(row.subscription) : null)
      }
      const sub = subs.get(r.device)
      if (!sub) continue
      try {
        const result = await sendPush(sub, { title: r.title, body: r.body, tag: r.tag }, vapid(env))
        if (result.gone) gone.add(r.device)
        else if (result.status === 429 || result.status >= 500) retry.push(r)
        else if (result.status >= 400) console.log('push failed', result.status)
      } catch (e) {
        console.log('push error', String(e))
        retry.push(r)
      }
    }
    const back = retry.filter((r) => !gone.has(r.device))
    if (back.length) {
      await env.DB.batch(back.map((r) => env.DB.prepare('INSERT INTO reminders (device, at, title, body, tag) VALUES (?, ?, ?, ?, ?)').bind(r.device, r.at, r.title, r.body, r.tag)))
    }
    if (gone.size) {
      await env.DB.batch([...gone].flatMap((id) => [
        env.DB.prepare('DELETE FROM reminders WHERE device = ?').bind(id),
        env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id),
      ]))
    }
    // Устройства, которые не заходили 60 дней, забываем — вместе с их напоминаниями
    await env.DB.batch([
      env.DB.prepare('DELETE FROM devices WHERE updated < ?').bind(Date.now() - 60 * 86_400_000),
      env.DB.prepare('DELETE FROM reminders WHERE device NOT IN (SELECT id FROM devices)'),
    ])
  },
}
