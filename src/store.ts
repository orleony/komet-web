// Данные приложения: всё в памяти телефона (IndexedDB), логика — как у Store на Mac.
import { effect, signal } from '@preact/signals'
import { Priority, uuid } from './model'
import type { Area, ClassSlot, Note, Snapshot, SyncSetting, TaskItem, WeekParity } from './model'
import { addDays, dayHeader, daysLeft, isoWeekday, minutesOfDay, nowSec, startOfDay, startOfToday, startOfWeek, toDate, toSec } from './lib/dates'
import { defaultMusic, defaultStudy, normalize, parse, previousMusic, previousStudy } from './lib/keywords'
import { placeholderArea, router } from './lib/router'
import type { AreaTemplate } from './lib/templates'
import { inferBells, slotIndex } from './lib/schedule'
import { cleanSnapshot, tieKey } from './lib/sanitize'
import type { BellSlot, ParsedClass } from './lib/schedule'

// MARK: - Локальные настройки (только этого устройства)

export interface Prefs {
  morning: boolean
  morningTime: number
  classes: boolean
  classLead: number
  deadlines: boolean
  deadlineWhen: 'before' | 'same' | 'both'
  deadlineTime: number
  cleanup: 'weekly' | 'daily' | 'never'
  trashDays: number
  mlEnabled: boolean
  /** Вкладка «Пары»: кто не учится, может её спрятать */
  showSchedule: boolean
  /** Карточка «Настроим расписание» убрана */
  scheduleSetupDismissed: boolean
  /** Пары — списком по дням или сеткой */
  scheduleView: 'list' | 'grid'
  /** Напоминать о задачах со временем и за сколько минут */
  timed: boolean
  timedLead: number
  /** Выходные, добавленные в расписание вручную (6 — суббота, 7 — воскресенье), даже если пар пока нет */
  scheduleWeekend: number[]
}

const defaultPrefs: Prefs = {
  morning: true, morningTime: 8 * 60, classes: true, classLead: 10, deadlines: true, deadlineWhen: 'before',
  deadlineTime: 19 * 60, cleanup: 'weekly', trashDays: 30, mlEnabled: true,
  showSchedule: true, scheduleSetupDismissed: false, scheduleView: 'grid', scheduleWeekend: [], timed: true, timedLead: 15,
}

function loadPrefs(): Prefs {
  try {
    return { ...defaultPrefs, ...JSON.parse(localStorage.getItem('komet.prefs') ?? '{}') }
  } catch {
    return defaultPrefs
  }
}

export const prefs = signal<Prefs>(loadPrefs())
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs.value = { ...prefs.value, [key]: value }
  try {
    localStorage.setItem('komet.prefs', JSON.stringify(prefs.value))
  } catch {}
  if (key === 'cleanup' || key === 'trashDays') cleanUp()
}

// MARK: - Хранение

const emptySnapshot: Snapshot = { tasks: [], notes: [], classes: [], areas: [], settings: [] }
export const data = signal<Snapshot>(emptySnapshot)
export const loaded = signal(false)
/** Тикает раз в 30 секунд — для «идёт · ещё 25 мин» */
export const clock = signal(new Date())

let dbPromise: Promise<IDBDatabase> | null = null
function openDB(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('komet', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => {
      const db = req.result
      db.onclose = () => (dbPromise = null)
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    req.onerror = () => { dbPromise = null; reject(req.error) }
  })
  return dbPromise
}

async function readSnapshot(): Promise<Snapshot | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get('snapshot')
    req.onsuccess = () => resolve(req.result == null ? null : cleanSnapshot(req.result) ?? emptySnapshot)
    req.onerror = () => reject(req.error)
  })
}

/** Запись в одной транзакции: прочитали сохранённое (другая вкладка могла успеть), слили со своим, записали.
 *  Транзакции IndexedDB к одному хранилищу идут по очереди — две вкладки не затрут друг друга. */
async function saveMerged(mine: Snapshot): Promise<Snapshot> {
  const db = await openDB()
  return new Promise<Snapshot>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    const store = tx.objectStore('kv')
    let result = mine
    const req = store.get('snapshot')
    req.onsuccess = () => {
      const disk = req.result == null ? null : cleanSnapshot(req.result)
      if (disk) result = mergeSnapshots(mine, disk, false).snapshot
      store.put(result, 'snapshot')
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Слияние двух снимков: по каждой записи побеждает более свежая правка.
 *  tie — при одинаковом времени правки выбирать по содержимому (для файлов с других устройств);
 *  между вкладками одного телефона одинаковое время — это одна и та же запись, оставляем свою. */
export function mergeSnapshots(local: Snapshot, incoming: Snapshot, tie = true): { snapshot: Snapshot; count: number } {
  let count = 0
  const merge = <T extends { id: string; updatedAt: number }>(mine: T[], other: T[]): T[] => {
    const byID = new Map(mine.map((x) => [x.id, x]))
    for (const r of other) {
      const m = byID.get(r.id)
      const newer = !m || r.updatedAt > m.updatedAt
      if (newer || (tie && m && r.updatedAt === m.updatedAt && tieKey(r) > tieKey(m))) {
        byID.set(r.id, r)
        count++
      }
    }
    return [...byID.values()]
  }
  return {
    snapshot: {
      tasks: merge(local.tasks, incoming.tasks),
      notes: merge(local.notes, incoming.notes),
      classes: merge(local.classes, incoming.classes),
      areas: merge(local.areas, incoming.areas),
      settings: merge(local.settings, incoming.settings),
    },
    count,
  }
}

/** Не удалось прочитать память — ничего не пишем, чтобы не затереть данные пустыми, и говорим об этом */
let readFailed = false
export const storageProblem = signal(false)
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('komet') : null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function readWithRetry(): Promise<Snapshot | null> {
  for (let i = 0; ; i++) {
    try {
      return await readSnapshot()
    } catch (e) {
      dbPromise = null
      if (i >= 2) throw e
      await sleep(300 * (i + 1))
    }
  }
}

let dirty = false
let pending: number | undefined
let saving: Promise<void> | null = null

function markDirty(delay = 250) {
  dirty = true
  clearTimeout(pending)
  pending = window.setTimeout(flush, delay)
}

async function flush(): Promise<void> {
  clearTimeout(pending)
  if (saving) {
    await saving
    if (dirty) return flush()
    return
  }
  if (!dirty || readFailed) return
  dirty = false
  saving = (async () => {
    try {
      const merged = await saveMerged(data.value)
      // В сохранённом оказалось то, чего у нас нет (правка из другой вкладки) — добавляем к тому, что в памяти сейчас:
      // пока шло сохранение, здесь могли сделать новую правку, её не теряем
      const { snapshot, count } = mergeSnapshots(data.value, merged, false)
      if (count) commit(snapshot, false)
      channel?.postMessage('saved')
    } catch {
      // Соединение с хранилищем могло сломаться — откроем заново и попробуем ещё раз
      dbPromise = null
      markDirty(3000)
    }
  })()
  await saving
  saving = null
}

/** Подтягиваем то, что сохранила другая вкладка (или окно); заодно чиним, если память не читалась */
async function pullFromDisk() {
  try {
    const saved = await readWithRetry()
    if (readFailed) {
      readFailed = false
      storageProblem.value = false
    }
    if (!saved) return
    const { snapshot, count } = mergeSnapshots(data.value, saved, false)
    if (count) commit(snapshot, false)
    // А у нас есть то, чего нет на диске, — сохраняем
    if (mergeSnapshots(saved, data.value, false).count) markDirty()
  } catch {}
}

export async function load() {
  let saved: Snapshot | null = null
  try {
    saved = await readWithRetry()
  } catch {
    readFailed = true
    storageProblem.value = true
  }
  data.value = saved ?? emptySnapshot
  upgradeDefaultKeywords()
  // Разделов по умолчанию нет: всё попадает во «Входящие», а Komet подсказывает, какой раздел создать
  syncRouter()
  cleanUp()
  loaded.value = true
  // Просим не стирать данные при нехватке места
  navigator.storage?.persist?.()
  setInterval(() => {
    const prev = clock.value
    clock.value = new Date()
    if (prev.toDateString() !== clock.value.toDateString()) cleanUp()
  }, 30_000)

  effect(() => {
    data.value
    if (!loaded.peek() || fromDisk) return
    markDirty()
  })
  // Закрыли приложение сразу после правки — сохраняем не дожидаясь таймера
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
    else pullFromDisk()
  })
  window.addEventListener('pagehide', () => flush())
  channel?.addEventListener('message', () => pullFromDisk())
}

let fromDisk = false

/** Стандартные слова Учёбы и Музыки, которые пользователь не трогал, — на новые (как на Mac). */
function upgradeDefaultKeywords() {
  const same = (a: string, b: string) => parse(a).join(',') === parse(b).join(',')
  const pairs: [string, string, string][] = [
    ['study', previousStudy, defaultStudy],
    ['music', previousMusic, defaultMusic],
    ['music', previousMusic.replace('видео, ', ''), defaultMusic.replace('видео, ', '')],
  ]
  const now = nowSec()
  let changed = false
  const next = data.value.areas.map((a) => {
    const t = (a.template ?? a.id)
    const pair = pairs.find(([id, old]) => id === t && same(a.keywords, old))
    if (!pair || a.deletedAt) return a
    changed = true
    return { ...a, keywords: pair[2], updatedAt: now }
  })
  if (changed) data.value = { ...data.value, areas: next }
}

function commit(next: Partial<Snapshot>, save = true) {
  fromDisk = !save
  try {
    data.value = { ...data.value, ...next }
  } finally {
    fromDisk = false
  }
  syncRouter()
}

function syncRouter() {
  const d = data.value
  router.areas = areas()
  router.fallbackID = shared(fallbackKey) ?? 'none'
  router.mlEnabled = prefs.value.mlEnabled
  try {
    router.retrain(d.tasks.filter((t) => !t.deletedAt))
  } catch (e) {
    console.error('retrain', e)
  }
}

const upsert = <T extends { id: string }>(list: T[], item: T) => {
  const i = list.findIndex((x) => x.id === item.id)
  return i < 0 ? [...list, item] : list.map((x, j) => (j === i ? item : x))
}

// MARK: - Общие настройки (как на Mac)

const parityKey = 'lyo.parityAnchor'
const fallbackKey = 'areas.fallback'

function shared(key: string): string | null {
  return data.value.settings.find((s) => s.id === key)?.value ?? null
}

function setShared(key: string, value: string | null) {
  const s: SyncSetting = { id: key, value, updatedAt: nowSec() }
  commit({ settings: upsert(data.value.settings, s) })
}

// MARK: - Разделы

export function areas(): Area[] {
  return data.value.areas.filter((a) => !a.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
}

export const fallbackArea = () => router.fallback
export const areaOf = (task: TaskItem) => router.area(task.areaID)

/** «Входящие» — задачи без раздела (и из удалённых разделов) */
export const inbox = placeholderArea
export const isInbox = (t: TaskItem) => !areas().some((a) => a.id === t.areaID)

/** Раздел из готового шаблона (с его встроенными знаниями); если такой уже есть — его же. */
export function addAreaFromTemplate(t: AreaTemplate): Area {
  const existing = areas().find((a) => (a.template ?? a.id) === t.id)
  if (existing) return existing
  return addArea({ title: t.title, icon: t.icon, colorIndex: t.colorIndex, keywords: t.keywords, template: t.id })
}

export function addArea(a: Omit<Area, 'id' | 'sortOrder' | 'createdAt' | 'updatedAt'>): Area {
  const now = nowSec()
  const area: Area = { ...a, id: uuid(), sortOrder: Math.max(-1, ...areas().map((x) => x.sortOrder)) + 1, createdAt: now, updatedAt: now }
  commit({ areas: [...data.value.areas, area] })
  return area
}

export function saveArea(a: Area) {
  commit({ areas: upsert(data.value.areas, { ...a, updatedAt: nowSec() }) })
}

/** Удаляет раздел; его задачи переезжают в раздел по умолчанию или во «Входящие». */
export function deleteArea(a: Area) {
  const target = a.id === fallbackArea().id ? placeholderArea : fallbackArea()
  if (a.id === fallbackArea().id) setShared(fallbackKey, null)
  const now = nowSec()
  commit({
    areas: upsert(data.value.areas, { ...a, deletedAt: now, updatedAt: now }),
    tasks: data.value.tasks.map((t) => (t.areaID === a.id ? { ...t, areaID: target.id, updatedAt: now } : t)),
  })
}

export function moveArea(a: Area, offset: number) {
  const list = areas()
  const i = list.findIndex((x) => x.id === a.id)
  const j = Math.min(Math.max(i + offset, 0), list.length - 1)
  if (i < 0 || i === j) return
  ;[list[i], list[j]] = [list[j], list[i]]
  const now = nowSec()
  const changed = list.map((x, index) => (x.sortOrder === index ? x : { ...x, sortOrder: index, updatedAt: now }))
  commit({ areas: data.value.areas.map((x) => changed.find((c) => c.id === x.id) ?? x) })
}

/** Раздел, куда уходит всё неузнанное; null — во «Входящие». */
export function setFallback(a: Area | null) {
  setShared(fallbackKey, a?.id ?? null)
}

// MARK: - Задачи

const live = (t: TaskItem) => !t.deletedAt
export const tasks = () => data.value.tasks.filter((t) => live(t) && !t.trashedAt)
export const trash = () => data.value.tasks.filter((t) => live(t) && t.trashedAt).sort((a, b) => b.trashedAt! - a.trashedAt!)

function byDue(a: TaskItem, b: TaskItem): number {
  if (a.dueDate != null && b.dueDate != null) {
    if (a.dueDate !== b.dueDate) return a.dueDate - b.dueDate
    // В один день: сначала со временем, по порядку; потом на весь день
    if ((a.dueTime ?? null) !== (b.dueTime ?? null)) return a.dueTime == null ? 1 : b.dueTime == null ? -1 : a.dueTime - b.dueTime
    if (a.priority !== b.priority) return b.priority - a.priority
    return a.createdAt - b.createdAt
  }
  if (a.dueDate == null && b.dueDate == null) return a.createdAt - b.createdAt
  return a.dueDate != null ? -1 : 1
}

/** areaID 'none' — «Входящие»: задачи без существующего раздела */
const inArea = (t: TaskItem, areaID?: string) => !areaID || (areaID === placeholderArea.id ? isInbox(t) : t.areaID === areaID)
export const openTasks = (areaID?: string) => tasks().filter((t) => !t.isDone && inArea(t, areaID)).sort(byDue)
export const doneTasks = (areaID?: string) =>
  tasks().filter((t) => t.isDone && inArea(t, areaID)).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))

/** Все задачи со сроком — чем ближе дата, тем выше. */
export const plan = () => openTasks().filter((t) => t.dueDate != null)
export const undated = () => openTasks().filter((t) => t.dueDate == null)
export const urgentCount = () => plan().filter((t) => daysLeft(toDate(t.dueDate)!) <= 1).length
export const doneToday = () => doneTasks().filter((t) => t.doneAt != null && daysLeft(toDate(t.doneAt)!) === 0)

export function planByDay(): { title: string; items: TaskItem[] }[] {
  const groups: { title: string; items: TaskItem[] }[] = []
  for (const t of plan()) {
    const due = toDate(t.dueDate)!
    const title = daysLeft(due) < 0 ? 'Просрочено' : dayHeader(due)
    if (groups.length && groups[groups.length - 1].title === title) groups[groups.length - 1].items.push(t)
    else groups.push({ title, items: [t] })
  }
  return groups
}

export function buckets(open: TaskItem[]): { title: string; items: TaskItem[] }[] {
  const today = startOfToday().getTime() / 1000
  const tomorrow = addDays(startOfToday(), 1).getTime() / 1000
  const week = addDays(startOfToday(), 8).getTime() / 1000
  const g: [string, TaskItem[]][] = [['Просрочено', []], ['Сегодня', []], ['Ближайшие дни', []], ['Позже', []], ['Без даты', []]]
  for (const t of open) {
    const d = t.dueDate
    if (d == null) g[4][1].push(t)
    else if (d < today) g[0][1].push(t)
    else if (d < tomorrow) g[1][1].push(t)
    else if (d < week) g[2][1].push(t)
    else g[3][1].push(t)
  }
  return g.filter(([, items]) => items.length).map(([title, items]) => ({ title, items }))
}

export function addTask(title: string, areaID: string, due: Date | null, priority = Priority.Normal, time: number | null = null) {
  const t = title.trim()
  if (!t) return
  const now = nowSec()
  const task: TaskItem = { id: uuid(), title: t, details: '', areaID, dueDate: toSec(due), dueTime: due ? time : null, isDone: false, doneAt: null, createdAt: now, updatedAt: now, priority, trashedAt: null }
  commit({ tasks: [...data.value.tasks, task] })
}

/** Сохраняет правки; корзину берём из базы, а не из копии на экране. */
export function saveTask(task: TaskItem, keepTrashState = true) {
  const current = data.value.tasks.find((t) => t.id === task.id)
  if (!current || current.deletedAt) return
  const next = { ...task, trashedAt: keepTrashState ? current.trashedAt : task.trashedAt, updatedAt: nowSec() }
  commit({ tasks: upsert(data.value.tasks, next) })
}

export function toggleTask(task: TaskItem) {
  const isDone = !task.isDone
  saveTask({ ...task, isDone, doneAt: isDone ? nowSec() : null })
}

export const deleteTask = (t: TaskItem) => saveTask({ ...t, trashedAt: nowSec() }, false)
/** Выполненную, но возвращённую задачу ставим «выполнено сейчас» — иначе уборка тут же унесёт её обратно */
export const restoreTask = (t: TaskItem) => saveTask({ ...t, trashedAt: null, doneAt: t.isDone ? nowSec() : t.doneAt }, false)
export const purgeTask = (t: TaskItem) => saveTask({ ...t, deletedAt: nowSec() }, false)

// MARK: - Корзина

export const noteTrash = () => data.value.notes.filter((n) => !n.deletedAt && n.trashedAt).sort((a, b) => b.trashedAt! - a.trashedAt!)
export const trashCount = () => trash().length + noteTrash().length

export function emptyTrash() {
  const now = nowSec()
  commit({
    tasks: data.value.tasks.map((t) => (!t.deletedAt && t.trashedAt ? { ...t, deletedAt: now, updatedAt: now } : t)),
    notes: data.value.notes.map((n) => (!n.deletedAt && n.trashedAt ? { ...n, deletedAt: now, updatedAt: now } : n)),
  })
}

/** Выполненное уезжает в корзину (по умолчанию — в ночь на понедельник), старое из корзины удаляется. */
export function cleanUp(now = new Date()) {
  const p = prefs.value
  const border = p.cleanup === 'never' ? null : p.cleanup === 'daily' ? startOfDay(now) : startOfWeek(now)
  const borderSec = border ? border.getTime() / 1000 : null
  const limit = (now.getTime() - p.trashDays * 86_400_000) / 1000
  const t = nowSec()
  let changed = false
  const nextTasks = data.value.tasks.map((task) => {
    if (task.deletedAt) return task
    if (!task.trashedAt && borderSec != null && task.isDone && (task.doneAt ?? Infinity) < borderSec) {
      changed = true
      return { ...task, trashedAt: t, updatedAt: t }
    }
    if (task.trashedAt && p.trashDays > 0 && task.trashedAt < limit) {
      changed = true
      return { ...task, deletedAt: t, updatedAt: t }
    }
    return task
  })
  const nextNotes = data.value.notes.map((n) => {
    if (!n.deletedAt && n.trashedAt && p.trashDays > 0 && n.trashedAt < limit) {
      changed = true
      return { ...n, deletedAt: t, updatedAt: t }
    }
    return n
  })
  if (changed) commit({ tasks: nextTasks, notes: nextNotes })
}

// MARK: - Заметки

export const notes = () =>
  data.value.notes
    .filter((n) => !n.deletedAt && !n.trashedAt)
    .sort((a, b) => (a.isPinned !== b.isPinned ? (a.isPinned ? -1 : 1) : b.updatedAt - a.updatedAt))

/** Заметка, даже если она в корзине (для «Вернуть») */
export const noteAny = (id: string) => data.value.notes.find((n) => n.id === id && !n.deletedAt) ?? null
export const note = (id: string) => data.value.notes.find((n) => n.id === id && !n.deletedAt && !n.trashedAt) ?? null

export function addNote(text = '', html: string | null = null): Note {
  const now = nowSec()
  const n: Note = { id: uuid(), text: text.trim(), html, kind: 'note', isPinned: false, createdAt: now, updatedAt: now, trashedAt: null }
  commit({ notes: [...data.value.notes, n] })
  return n
}

export function saveNote(id: string, change: Partial<Note>) {
  const n = data.value.notes.find((x) => x.id === id)
  if (!n || n.deletedAt) return
  commit({ notes: upsert(data.value.notes, { ...n, ...change, updatedAt: nowSec() }) })
}

export const deleteNote = (n: Note) => saveNote(n.id, { trashedAt: nowSec() })
export const restoreNote = (n: Note) => saveNote(n.id, { trashedAt: null })
export const purgeNote = (n: Note) => saveNote(n.id, { deletedAt: nowSec() })
export const setPinned = (id: string, pinned: boolean) => saveNote(id, { isPinned: pinned })

/** Пустая заметка, которую покинули, — удаляем без следа. */
export function discardIfEmpty(id: string) {
  const n = note(id)
  if (n && !n.text.trim() && !n.audioFile) saveNote(id, { deletedAt: nowSec() })
}

export function noteTitle(n: Note): string {
  const first = (n.text.split('\n').find((l) => l.trim()) ?? '').replace(/^[☐☑•–]\s|^\d{1,3}\.\s/, '')
  return first.trim() || (n.audioFile ? 'Голосовая заметка' : 'Без названия')
}

export function notePreview(n: Note): string {
  const lines = n.text.split('\n').filter((l) => l.trim())
  return lines.slice(1).map((l) => l.replace(/^[☐☑•–]\s|^\d{1,3}\.\s/, '')).join(' ')
}

// MARK: - Расписание

export const classes = () => data.value.classes.filter((c) => !c.deletedAt)
export const weekStart = (d: Date) => startOfWeek(d).getTime()
export const classesOnWeekday = (weekday: number) => classes().filter((c) => c.weekday === weekday).sort((a, b) => a.startMin - b.startMin)

/** Пары на конкретную дату с учётом числителя/знаменателя. */
export function classesOn(date: Date): ClassSlot[] {
  const parity = weekParity(date)
  return classesOnWeekday(isoWeekday(date)).filter((c) => c.parity === 'every' || parity == null || c.parity === parity)
}

export function weekParity(date: Date): WeekParity | null {
  const raw = shared(parityKey)
  if (!raw) return null
  // Якорь — понедельник 00:00 (или четверг 12:00); берём полдень — смена часового пояса не сдвинет неделю
  const anchor = new Date(Number(raw) * 1000 + 12 * 3_600_000)
  const weeks = Math.round((startOfWeek(date).getTime() - startOfWeek(anchor).getTime()) / (7 * 86_400_000))
  return ((weeks % 2) + 2) % 2 === 0 ? 'numerator' : 'denominator'
}

/** Говорим, какая сейчас неделя; null — без деления. Храним четверг этой недели в полдень, как Mac. */
export function setCurrentWeek(parity: WeekParity | null) {
  const thursday = new Date(startOfWeek(new Date()).getTime() + (3 * 24 + 12) * 3_600_000)
  if (parity === 'numerator') setShared(parityKey, String(thursday.getTime() / 1000))
  else if (parity === 'denominator') setShared(parityKey, String(addDays(thursday, -7).getTime() / 1000))
  else setShared(parityKey, null)
}

export function saveClass(slot: ClassSlot) {
  commit({ classes: upsert(data.value.classes, { ...slot, updatedAt: nowSec() }) })
}

export const deleteClass = (slot: ClassSlot) => saveClass({ ...slot, deletedAt: nowSec() })

/** Дни в расписании: будни всегда, суббота и воскресенье — если в них есть пары или их добавили. */
export function scheduleDays(): number[] {
  const extra = prefs.value.scheduleWeekend ?? []
  return [1, 2, 3, 4, 5, ...[6, 7].filter((d) => extra.includes(d) || classesOnWeekday(d).length > 0)]
}

/** Добавить или убрать выходной из расписания (убрать можно только пустой). */
export function setWeekendDay(day: number, on: boolean) {
  const extra = new Set(prefs.value.scheduleWeekend ?? [])
  if (on) extra.add(day)
  else extra.delete(day)
  setPref('scheduleWeekend', [...extra].sort())
}

// MARK: - Звонки и сетка

const bellsKey = 'schedule.bells'
/** Особые звонки отдельных дней: { "2": [...] } — например, военная кафедра по вторникам с 10:00 */
const dayBellsKey = 'schedule.bells.days'

function parseBells(raw: string | null): BellSlot[] | null {
  if (!raw) return null
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) && list.length ? list : null
  } catch {
    return null
  }
}

function dayBellsMap(): Record<string, BellSlot[]> {
  try {
    const map = JSON.parse(shared(dayBellsKey) ?? '{}')
    return map && typeof map === 'object' ? map : {}
  } catch {
    return {}
  }
}

/** Звонки «для всех дней»: заданные мастером или подобранные по уже введённым парам.
 *  Подбираем по времени, которое встречается хотя бы в двух днях: особый день (ВУЦ по вторникам) не портит общую сетку. */
export function bells(): BellSlot[] {
  const set = parseBells(shared(bellsKey))
  if (set) return set
  const custom = dayBellsMap()
  const list = classes().filter((c) => !custom[c.weekday])
  const days = new Map<number, Set<number>>()
  for (const c of list) days.set(c.startMin, (days.get(c.startMin) ?? new Set()).add(c.weekday))
  const multiDay = new Set(list.map((c) => c.weekday)).size > 1
  return inferBells(list.filter((c) => !multiDay || (days.get(c.startMin)?.size ?? 0) >= 2))
}

/** Особые звонки дня или null — день идёт по общим. */
export function dayBells(weekday: number): BellSlot[] | null {
  const list = dayBellsMap()[weekday]
  return Array.isArray(list) && list.length ? list : null
}

/** Звонки конкретного дня: особые, если заданы, иначе общие. */
export const bellsFor = (weekday: number) => dayBells(weekday) ?? bells()

export const hasBells = () => !!shared(bellsKey) || Object.keys(dayBellsMap()).length > 0

/** Дни, где пары не попадают в общие звонки и особых звонков нет, — им стоит задать свои. */
export function offBellDays(): number[] {
  const common = bells()
  const days = new Set<number>()
  for (const c of classes()) if (!dayBells(c.weekday) && slotIndex(common, c.startMin) == null) days.add(c.weekday)
  return [...days].sort()
}

/** Новые звонки — для всех дней (weekday не задан) или только для одного дня.
 *  next — в том же порядке, что старые (i-я пара → i-я пара), даже если время поменяли местами:
 *  пара, стоявшая на i-й паре (с допуском ±15 мин), переезжает на новое время i-й пары. */
export function setBells(next: BellSlot[], weekday?: number) {
  const old = weekday ? bellsFor(weekday) : bells()
  const custom = dayBellsMap()
  const now = nowSec()
  const moved = data.value.classes.map((c) => {
    if (c.deletedAt) return c
    // Общие звонки не трогают дни с особыми; особые — только свой день
    if (weekday ? c.weekday !== weekday : custom[c.weekday]) return c
    const i = slotIndex(old, c.startMin)
    const target = i != null ? next[i] : undefined
    return target && (target.start !== c.startMin || target.end !== c.endMin) ? { ...c, startMin: target.start, endMin: target.end, updatedAt: now } : c
  })
  commit({ classes: moved })
  const sorted = [...next].sort((a, b) => a.start - b.start)
  if (weekday) setShared(dayBellsKey, JSON.stringify({ ...custom, [weekday]: sorted }))
  else setShared(bellsKey, JSON.stringify(sorted))
}

/** День снова идёт по общим звонкам (пары остаются на своём времени). */
export function clearDayBells(weekday: number) {
  const custom = dayBellsMap()
  delete custom[weekday]
  setShared(dayBellsKey, JSON.stringify(custom))
}

/** Звонки дня — по его парам: одно нажатие для «во вторник всё по-другому». */
export function fitDayBells(weekday: number) {
  const custom = dayBellsMap()
  setShared(dayBellsKey, JSON.stringify({ ...custom, [weekday]: inferBells(classesOnWeekday(weekday)) }))
}

export interface CellEntry {
  /** Пара, из которой взята запись (новая — без id) */
  id?: string
  /** Ключ формы в редакторе (не сохраняется) */
  key?: string
  parity: WeekParity
  title: string
  teacher: string
  room: string
  kind: string
}

/** Пары клетки после правки. Удаляются только пары из opened (те, что были в редакторе) и не оставшиеся в entries:
 *  чужие пары в той же клетке не трогаем. */
/** Подгруппы в клетке подписаны: две пары одной недели — «1 подгр.» и «2 подгр.»; осталась одна — подпись убираем. */
export function labelSubgroups(entries: CellEntry[]): CellEntry[] {
  const filled = entries.filter((x) => x.title.trim())
  return filled.map((e) => {
    const same = filled.filter((x) => x.parity === e.parity)
    const base = e.kind.split(/\s*·\s*/).filter((k) => k && !/подгр/.test(k)).join(' · ')
    const n = same.indexOf(e) + 1
    return { ...e, kind: same.length > 1 ? [base, `${n} подгр.`].filter(Boolean).join(' · ') : base }
  })
}

export function setCell(weekday: number, slot: BellSlot, entries: CellEntry[], opened: string[]) {
  const now = nowSec()
  const kept = new Set<string>()
  const next = [...data.value.classes]
  for (const e of labelSubgroups(entries)) {
    const existing = e.id && !kept.has(e.id) ? next.find((c) => c.id === e.id && !c.deletedAt) : undefined
    const base = existing ?? ({ id: uuid(), createdAt: now } as ClassSlot)
    const c: ClassSlot = { ...base, weekday, startMin: slot.start, endMin: slot.end, title: e.title.trim(), teacher: e.teacher.trim(), room: e.room.trim(), kind: e.kind.trim(), parity: e.parity, updatedAt: now, deletedAt: null }
    kept.add(c.id)
    const i = next.findIndex((x) => x.id === c.id)
    if (i >= 0) next[i] = c
    else next.push(c)
  }
  const remove = new Set(opened.filter((id) => !kept.has(id)))
  commit({ classes: next.map((c) => (remove.has(c.id) && !c.deletedAt ? { ...c, deletedAt: now, updatedAt: now } : c)) })
}

/** Копирует пары одного дня на другой (пары того дня заменяются). Если у дней разные звонки — пары встают по номеру. */
export function copyDay(from: number, to: number) {
  const now = nowSec()
  const src = bellsFor(from)
  const dst = bellsFor(to)
  const copies = classesOnWeekday(from).map((c) => {
    const i = slotIndex(src, c.startMin)
    const moved = i != null && dst[i] && (dst[i].start !== src[i].start || dst[i].end !== src[i].end)
    return { ...c, id: uuid(), weekday: to, createdAt: now, updatedAt: now, ...(moved ? { startMin: dst[i!].start, endMin: dst[i!].end } : {}) }
  })
  commit({
    classes: [...data.value.classes.map((c) => (!c.deletedAt && c.weekday === to ? { ...c, deletedAt: now, updatedAt: now } : c)), ...copies],
  })
}

/** Пары из вставленного текста или календаря. replace — сначала убрать всё старое расписание. */
export function addParsedClasses(list: ParsedClass[], replace: boolean) {
  const now = nowSec()
  const fresh: ClassSlot[] = list
    .filter((p) => p.startMin != null)
    .map((p) => ({
      id: uuid(), weekday: p.weekday, startMin: p.startMin!, endMin: p.endMin != null && p.endMin > p.startMin! ? p.endMin : Math.min(p.startMin! + 90, 23 * 60 + 59), title: p.title, teacher: p.teacher,
      room: p.room, kind: p.kind, parity: p.parity, createdAt: now, updatedAt: now,
    }))
  const old = replace ? data.value.classes.map((c) => (c.deletedAt ? c : { ...c, deletedAt: now, updatedAt: now })) : data.value.classes
  // Та же пара уже есть (вставили расписание второй раз) — не дублируем
  const key = (c: ClassSlot) => [c.weekday, c.startMin, normalize(c.title.trim()), c.parity, normalize(c.kind), normalize(c.room), normalize(c.teacher)].join('|')
  const have = new Set(old.filter((c) => !c.deletedAt).map(key))
  const added = fresh.filter((c) => !have.has(key(c)) && (have.add(key(c)), true))
  commit({ classes: [...old, ...added] })
  return added.length
}

/** Все преподаватели из расписания (свежие — первыми); «Иванов И.И., Петров П.П.» — это двое. */
export function knownTeachers(): string[] {
  const seen = new Map<string, string>()
  for (const c of [...classes()].sort((a, b) => b.updatedAt - a.updatedAt)) {
    for (const t of c.teacher.split(/\s*[,;]\s*/)) {
      const name = t.trim()
      if (name && !seen.has(normalize(name))) seen.set(normalize(name), name)
    }
  }
  return [...seen.values()]
}

/** Кто обычно ведёт этот предмет */
export function teacherOf(title: string): string | null {
  const key = normalize(title.trim())
  if (!key) return null
  const c = [...classes()].sort((a, b) => b.updatedAt - a.updatedAt).find((x) => normalize(x.title.trim()) === key && x.teacher.trim())
  return c?.teacher ?? null
}

/** Основы слов из названий предметов и фамилий преподавателей: «лаба Вилисова» — это учёба. */
export function studyHints(): string[] {
  const stems = new Set<string>()
  for (const c of classes()) {
    for (const w of normalize(c.title + ' ' + c.teacher).split(/[^\p{L}]+/u)) {
      const chars = [...w]
      if (chars.length >= 4) stems.add(chars.slice(0, Math.max(4, chars.length - 2)).join(''))
    }
  }
  return [...stems]
}

// MARK: - Что важнее всего сейчас

export type NowItem = { kind: 'task'; task: TaskItem } | { kind: 'current'; slot: ClassSlot } | { kind: 'next'; slot: ClassSlot }

/** Горящая задача (сегодня/завтра/просрочена) важнее пары; идущая пара — важнее задачи на 2–3 дня. */
export function nowItem(date: Date): NowItem | null {
  const minute = minutesOfDay(date)
  // Вкладка «Пары» спрятана — пары нигде не показываем
  const todays = prefs.value.showSchedule ? classesOn(date) : []
  const current = todays.find((c) => minute >= c.startMin && minute < c.endMin)
  const next = todays.find((c) => c.startMin > minute)
  const urgent = plan()[0]
  const days = urgent ? daysLeft(toDate(urgent.dueDate)!) : 99
  if (urgent && days <= 1) return { kind: 'task', task: urgent }
  if (current) return { kind: 'current', slot: current }
  if (urgent && days <= 3) return { kind: 'task', task: urgent }
  if (next) return { kind: 'next', slot: next }
  return null
}

// MARK: - Перенос с Mac

/** Принимает файл экспорта (с Mac или с другого телефона): побеждает более свежая правка. */
export function importSnapshot(raw: unknown): number {
  const incoming = cleanSnapshot(raw)
  if (!incoming) throw new Error('Это не файл Komet')
  const { snapshot, count } = mergeSnapshots(data.value, incoming)
  if (count) commit(snapshot)
  return count
}

export const exportSnapshot = (): Snapshot => data.value
