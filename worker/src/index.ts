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

function validSubscription(s: any): s is Subscription {
  return s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://') && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string'
}

function cleanReminders(list: unknown): Reminder[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((r) => r && Number.isFinite(r.at) && typeof r.title === 'string')
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
        const body: any = await request.json()
        if (!validSubscription(body.subscription)) return json({ error: 'bad subscription' }, 400)
        const id = crypto.randomUUID()
        const token = crypto.randomUUID() + crypto.randomUUID()
        await env.DB.prepare('INSERT INTO devices (id, token_hash, subscription, updated) VALUES (?, ?, ?, ?)')
          .bind(id, await sha256(token), JSON.stringify(body.subscription), Date.now()).run()
        await replaceReminders(env, id, cleanReminders(body.reminders))
        return json({ id, token })
      }

      if (parts[0] === 'devices' && parts[1]) {
        const id = parts[1]
        const body: any = request.method === 'DELETE' || request.method === 'PUT' || request.method === 'POST' ? await request.json() : {}
        if (!(await authorized(env, id, body.token))) return json({ error: 'unknown device' }, 404)

        // Новое расписание напоминаний (и, если сменилась, подписка)
        if (request.method === 'PUT' && parts.length === 2) {
          if (body.subscription && validSubscription(body.subscription)) {
            await env.DB.prepare('UPDATE devices SET subscription = ?, updated = ? WHERE id = ?').bind(JSON.stringify(body.subscription), Date.now(), id).run()
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
      return json({ error: String(e) }, 500)
    }
  },

  /** Раз в минуту: рассылаем всё, чьё время пришло; совсем старое (больше 15 минут) — просто выбрасываем. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const due = await env.DB.prepare(
      'SELECT r.rowid AS rid, r.device, r.at, r.title, r.body, r.tag, d.subscription FROM reminders r JOIN devices d ON d.id = r.device WHERE r.at <= ? ORDER BY r.at LIMIT 500',
    ).bind(now).all<{ rid: number; device: string; at: number; title: string; body: string; tag: string; subscription: string }>()

    const gone = new Set<string>()
    for (const r of due.results) {
      if (gone.has(r.device) || r.at < now - 15 * 60) continue
      try {
        const result = await sendPush(JSON.parse(r.subscription), { title: r.title, body: r.body, tag: r.tag }, vapid(env))
        if (result.gone) gone.add(r.device)
      } catch {
        // Сеть моргнула — это напоминание пропускаем, остальные шлём
      }
    }
    if (due.results.length) {
      await env.DB.batch([
        ...due.results.map((r) => env.DB.prepare('DELETE FROM reminders WHERE rowid = ?').bind(r.rid)),
        ...[...gone].flatMap((id) => [
          env.DB.prepare('DELETE FROM reminders WHERE device = ?').bind(id),
          env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id),
        ]),
      ])
    }
    // Устройства, которые не заходили 60 дней, забываем
    await env.DB.prepare('DELETE FROM devices WHERE updated < ?').bind(Date.now() - 60 * 86_400_000).run()
  },
}
