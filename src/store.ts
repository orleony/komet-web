// Данные приложения: всё в памяти телефона (IndexedDB), логика — как у Store на Mac.
import { effect, signal } from '@preact/signals'
import { Priority, uuid } from './model'
import type { Area, ClassSlot, Note, Snapshot, SyncSetting, TaskItem, WeekParity } from './model'
import { addDays, dayHeader, daysLeft, isoWeekday, minutesOfDay, nowSec, startOfDay, startOfToday, startOfWeek, toDate, toSec } from './lib/dates'
import { normalize } from './lib/keywords'
import { placeholderArea, router } from './lib/router'
import type { AreaTemplate } from './lib/templates'

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
}

const defaultPrefs: Prefs = {
  morning: true, morningTime: 8 * 60, classes: true, classLead: 10, deadlines: true, deadlineWhen: 'before',
  deadlineTime: 19 * 60, cleanup: 'weekly', trashDays: 30, mlEnabled: true,
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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('komet', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readSnapshot(): Promise<Snapshot | null> {
  const db = await openDB()
  return new Promise((resolve) => {
    const req = db.transaction('kv').objectStore('kv').get('snapshot')
    req.onsuccess = () => resolve((req.result as Snapshot) ?? null)
    req.onerror = () => resolve(null)
  })
}

async function writeSnapshot(s: Snapshot) {
  const db = await openDB()
  await new Promise<void>((resolve) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(s, 'snapshot')
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function load() {
  const saved = await readSnapshot()
  data.value = saved ? { ...emptySnapshot, ...saved } : emptySnapshot
  // Разделов по умолчанию нет: всё попадает во «Входящие», а Komet подсказывает, какой раздел создать
  syncRouter()
  cleanUp()
  loaded.value = true
  // Просим не стирать данные при нехватке места
  navigator.storage?.persist?.()
  setInterval(() => (clock.value = new Date()), 30_000)
  let pending: number | undefined
  effect(() => {
    const snapshot = data.value
    if (!loaded.peek()) return
    clearTimeout(pending)
    pending = window.setTimeout(() => writeSnapshot(snapshot), 250)
  })
}

function commit(next: Partial<Snapshot>) {
  data.value = { ...data.value, ...next }
  syncRouter()
}

function syncRouter() {
  const d = data.value
  router.areas = areas()
  router.fallbackID = shared(fallbackKey) ?? 'none'
  router.mlEnabled = prefs.value.mlEnabled
  router.retrain(d.tasks.filter((t) => !t.deletedAt))
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

export function addTask(title: string, areaID: string, due: Date | null, priority = Priority.Normal) {
  const t = title.trim()
  if (!t) return
  const now = nowSec()
  const task: TaskItem = { id: uuid(), title: t, details: '', areaID, dueDate: toSec(due), isDone: false, doneAt: null, createdAt: now, updatedAt: now, priority, trashedAt: null }
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
  const todays = classesOn(date)
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
export function importSnapshot(incoming: Partial<Snapshot>): number {
  let count = 0
  const merge = <T extends { id: string; updatedAt: number }>(local: T[], other: T[] = []): T[] => {
    const byID = new Map(local.map((x) => [x.id, x]))
    for (const r of other) {
      if (!r?.id) continue
      const mine = byID.get(r.id)
      if (!mine || r.updatedAt > mine.updatedAt) {
        byID.set(r.id, r)
        count++
      }
    }
    return [...byID.values()]
  }
  const d = data.value
  // Mac хранит оформление заметок в RTF — здесь показываем простой текст, RTF оставляем как есть
  const incomingNotes = (incoming.notes ?? []).map((n) => ({ ...n, html: n.html ?? null }))
  commit({
    tasks: merge(d.tasks, incoming.tasks),
    notes: merge(d.notes, incomingNotes),
    classes: merge(d.classes, incoming.classes),
    areas: merge(d.areas, incoming.areas),
    settings: merge(d.settings, incoming.settings),
  })
  return count
}

export const exportSnapshot = (): Snapshot => data.value
