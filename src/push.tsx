// Напоминания через Web Push: телефон считает расписание, сервер (Cloudflare Worker) присылает вовремя.
import { effect, signal } from '@preact/signals'
import { useState } from 'preact/hooks'
import { Bell, BellOff } from 'lucide-preact'
import * as store from './store'
import { buildReminders } from './reminders'
import { Segments, Toggle, showToast } from './ui/controls'

const SERVER = (import.meta.env.VITE_PUSH_URL as string | undefined)?.replace(/\/$/, '')

type PushState = 'no-server' | 'unsupported' | 'needs-install' | 'off' | 'denied' | 'on'

interface Device { id: string; token: string }

function loadDevice(): Device | null {
  try {
    return JSON.parse(localStorage.getItem('komet.push') ?? 'null')
  } catch {
    return null
  }
}

function saveDevice(d: Device | null) {
  try {
    if (d) localStorage.setItem('komet.push', JSON.stringify(d))
    else localStorage.removeItem('komet.push')
  } catch {}
}

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

function currentState(): PushState {
  if (!SERVER) return 'no-server'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // На iPhone push есть только у приложения, добавленного на экран «Домой»
    return isIOS() && !standalone() ? 'needs-install' : 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  return loadDevice() && Notification.permission === 'granted' ? 'on' : 'off'
}

export const pushState = signal<PushState>(currentState())

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(SERVER + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

async function subscription(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  const { publicKey } = await api('/vapid', 'GET')
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0))
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

/** Включить напоминания: разрешение, подписка, первое расписание. Вызывать по нажатию кнопки. */
export async function enablePush(): Promise<void> {
  paused = true
  again = false
  try {
    await syncing
    await enable()
  } finally {
    paused = false
  }
}

async function enable(): Promise<void> {
  // Старое устройство на сервере — убираем, чтобы напоминания не приходили дважды
  const old = loadDevice()
  if (old) await api(`/devices/${old.id}`, 'DELETE', { token: old.token }).catch(() => {})
  saveDevice(null)
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    pushState.value = permission === 'denied' ? 'denied' : 'off'
    return
  }
  const sub = await subscription()
  const device: Device = await api('/devices', 'POST', { subscription: sub.toJSON(), reminders: buildReminders() })
  saveDevice(device)
  pushState.value = 'on'
}

export async function disablePush(): Promise<void> {
  paused = true
  again = false
  try {
    await syncing
    await disable()
  } finally {
    paused = false
  }
}

async function disable(): Promise<void> {
  const device = loadDevice()
  if (device) await api(`/devices/${device.id}`, 'DELETE', { token: device.token }).catch(() => {})
  saveDevice(null)
  const reg = await navigator.serviceWorker.ready
  await (await reg.pushManager.getSubscription())?.unsubscribe()
  pushState.value = currentState()
}

export async function testPush(): Promise<void> {
  const device = loadDevice()
  if (device) await api(`/devices/${device.id}/test`, 'POST', { token: device.token })
}

let pending: number | undefined
let lastSent = ''
/** Одна синхронизация за раз — иначе две параллельные могут завести два устройства */
let syncing: Promise<void> | null = null

/** Отправить серверу свежее расписание (через пару секунд после правок). */
let again = false
/** Пока включаем или выключаем напоминания, фоновые отправки не начинаются — иначе гонка за устройство на сервере */
let paused = false
function syncReminders(): Promise<void> {
  if (paused) return Promise.resolve()
  // Уже отправляем — после неё отправим ещё раз со свежими данными (правка могла прийти посреди отправки)
  if (syncing) {
    again = true
    return syncing
  }
  syncing = doSync().catch(() => {}).finally(() => {
    syncing = null
    if (again && !paused) {
      again = false
      syncReminders()
    }
  })
  return syncing
}

async function doSync() {
  const device = loadDevice()
  if (!SERVER || !device || !('Notification' in window) || Notification.permission !== 'granted') return
  const reminders = buildReminders()
  const sub = await subscription()
  const payload = JSON.stringify([reminders, sub.endpoint])
  if (payload === lastSent) return
  try {
    await api(`/devices/${device.id}`, 'PUT', { token: device.token, subscription: sub.toJSON(), reminders })
    lastSent = payload
  } catch (e) {
    // Сервер забыл устройство (долго не заходили) — подписываемся заново
    if (String(e).includes('404')) {
      const fresh: Device = await api('/devices', 'POST', { subscription: sub.toJSON(), reminders })
      // Пока ждали ответа, напоминания выключили или включили заново — новое устройство не нужно
      if (loadDevice()?.id !== device.id) {
        await api(`/devices/${fresh.id}`, 'DELETE', { token: fresh.token }).catch(() => {})
        return
      }
      saveDevice(fresh)
      lastSent = payload
    }
  }
}

export function startReminderSync() {
  if (!SERVER) return
  effect(() => {
    store.data.value
    store.prefs.value
    clearTimeout(pending)
    pending = window.setTimeout(syncReminders, 2500)
  })
  // Открыли приложение — расписание на неделю вперёд обновляется
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncReminders())
}

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromTime = (v: string) => {
  const [h, m] = v.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function TimeInput({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  return (
    <div class="field" style={{ minHeight: 34 }}>
      <input type="time" value={toTime(value)} onInput={(e) => { const m = fromTime(e.currentTarget.value); if (m != null) onChange(m) }} style={{ padding: '6px 0' }} />
    </div>
  )
}

function PushStatus() {
  const [busy, setBusy] = useState(false)
  const state = pushState.value
  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) showToast(ok)
    } catch {
      showToast('Не получилось связаться с сервером напоминаний')
    } finally {
      setBusy(false)
    }
  }
  if (state === 'no-server') return <div class="hint">Сервер напоминаний ещё не подключён — настройки сохранятся и заработают позже.</div>
  if (state === 'needs-install') return <div class="hint" style={{ fontSize: 13 }}>Напоминания на iPhone работают, когда Komet добавлен на экран «Домой»: «Поделиться» → «На экран „Домой“», и открой его оттуда.</div>
  if (state === 'unsupported') return <div class="hint">Этот браузер не умеет присылать напоминания.</div>
  if (state === 'denied') return <div class="hint danger-text">Уведомления запрещены. Разреши их: Настройки iPhone → Уведомления → Komet.</div>
  if (state === 'off') {
    return (
      <button class="btn primary" disabled={busy} onClick={() => run(enablePush, 'Напоминания включены')}>
        <Bell size={16} /> {busy ? 'Включаю…' : 'Включить напоминания'}
      </button>
    )
  }
  return (
    <div class="row wrap">
      <span class="chip" style={{ color: 'var(--accent)', background: 'rgba(255,90,60,0.16)' }}><Bell size={12} /> Напоминания включены</span>
      <button class="btn-text" disabled={busy} onClick={() => run(testPush, 'Отправил — посмотри уведомления')}>Проверить</button>
      <button class="btn-text" style={{ color: 'var(--secondary)' }} disabled={busy} onClick={() => run(disablePush)}><BellOff size={14} /> Выключить</button>
    </div>
  )
}

export function NotificationsCard() {
  const p = store.prefs.value
  return (
    <div class="card section">
      <PushStatus />
      <Toggle on={p.morning} onChange={(v) => store.setPref('morning', v)} title="Утренняя сводка" subtitle="Сколько пар и что горит" />
      {p.morning && <div class="row"><span class="hint grow">Во сколько</span><TimeInput value={p.morningTime} onChange={(m) => store.setPref('morningTime', m)} /></div>}
      <Toggle on={p.classes} onChange={(v) => store.setPref('classes', v)} title="Перед парой" subtitle="Напоминание, куда идти" />
      {p.classes && <Segments value={p.classLead} onChange={(v) => store.setPref('classLead', v)} options={[5, 10, 15, 30].map((m) => ({ value: m, title: `${m} мин` }))} />}
      <Toggle on={p.deadlines} onChange={(v) => store.setPref('deadlines', v)} title="Дедлайны" subtitle="Напомнить о сроке" />
      {p.deadlines && (
        <>
          <Segments value={p.deadlineWhen} onChange={(v) => store.setPref('deadlineWhen', v)} options={[{ value: 'before', title: 'Накануне' }, { value: 'same', title: 'В день' }, { value: 'both', title: 'Оба раза' }]} />
          <div class="row"><span class="hint grow">Во сколько</span><TimeInput value={p.deadlineTime} onChange={(m) => store.setPref('deadlineTime', m)} /></div>
        </>
      )}
      <Toggle on={p.timed} onChange={(v) => store.setPref('timed', v)} title="Задачи ко времени" subtitle="«Завтра в 18:00 сдать лабу» — напомнить заранее" />
      {p.timed && (
        <Segments value={p.timedLead} onChange={(v) => store.setPref('timedLead', v)} options={[0, 15, 30, 60].map((m) => ({ value: m, title: m ? `${m} мин` : 'В срок' }))} />
      )}
    </div>
  )
}
