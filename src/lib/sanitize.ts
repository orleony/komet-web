// Проверка записей из файла импорта и из памяти: кривая запись не должна ломать приложение.
import type { Area, ClassSlot, Note, Snapshot, SyncSetting, TaskItem, WeekParity } from '../model'

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v))
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const optNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as any) : null)
const id = (v: unknown) => (typeof v === 'string' && v ? v : null)
const minute = (v: unknown) => Math.min(Math.max(Math.round(num(v)), 0), 1439)

export function cleanTask(v: unknown): TaskItem | null {
  const o = obj(v)
  if (!o || !id(o.id)) return null
  const p = num(o.priority)
  return {
    ...o,
    id: o.id, title: str(o.title), details: str(o.details), areaID: str(o.areaID, 'none') || 'none',
    dueDate: optNum(o.dueDate), dueTime: (() => { const t = optNum(o.dueTime); return t != null && t >= 0 && t < 1440 ? Math.round(t) : null })(), isDone: !!o.isDone, doneAt: optNum(o.doneAt),
    createdAt: num(o.createdAt), updatedAt: num(o.updatedAt), deletedAt: optNum(o.deletedAt), trashedAt: optNum(o.trashedAt),
    priority: p === 1 || p === 2 ? p : 0,
  }
}

export function cleanNote(v: unknown): Note | null {
  const o = obj(v)
  if (!o || !id(o.id)) return null
  return {
    ...o,
    id: o.id, text: str(o.text), kind: 'note', isPinned: !!o.isPinned,
    createdAt: num(o.createdAt), updatedAt: num(o.updatedAt), deletedAt: optNum(o.deletedAt), trashedAt: optNum(o.trashedAt),
    audioFile: typeof o.audioFile === 'string' ? o.audioFile : null,
    rich: typeof o.rich === 'string' ? o.rich : null,
    html: typeof o.html === 'string' ? o.html : null,
  }
}

const parities: WeekParity[] = ['every', 'numerator', 'denominator']

export function cleanClass(v: unknown): ClassSlot | null {
  const o = obj(v)
  if (!o || !id(o.id)) return null
  const weekday = Math.round(num(o.weekday, 1))
  const startMin = minute(o.startMin)
  return {
    ...o,
    id: o.id, weekday: weekday >= 1 && weekday <= 7 ? weekday : 1, startMin, endMin: Math.max(minute(o.endMin), startMin),
    title: str(o.title), teacher: str(o.teacher), room: str(o.room), kind: str(o.kind),
    parity: parities.includes(o.parity) ? o.parity : 'every',
    createdAt: num(o.createdAt), updatedAt: num(o.updatedAt), deletedAt: optNum(o.deletedAt),
  }
}

export function cleanArea(v: unknown): Area | null {
  const o = obj(v)
  if (!o || !id(o.id)) return null
  return {
    ...o,
    id: o.id, title: str(o.title) || 'Раздел', icon: str(o.icon, 'folder') || 'folder', colorIndex: Math.round(num(o.colorIndex)),
    keywords: str(o.keywords), sortOrder: num(o.sortOrder), createdAt: num(o.createdAt), updatedAt: num(o.updatedAt),
    deletedAt: optNum(o.deletedAt), template: typeof o.template === 'string' ? o.template : null,
  }
}

export function cleanSetting(v: unknown): SyncSetting | null {
  const o = obj(v)
  if (!o || !id(o.id)) return null
  return { id: o.id, value: o.value == null ? null : str(o.value), updatedAt: num(o.updatedAt) }
}

const list = <T>(v: unknown, clean: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.map(clean).filter((x): x is T => x !== null) : []

/** Любой JSON → правильный снимок; null — если это вообще не файл Komet. */
export function cleanSnapshot(v: unknown): Snapshot | null {
  const o = obj(v)
  if (!o) return null
  const keys = ['tasks', 'notes', 'classes', 'areas', 'settings']
  if (!keys.some((k) => Array.isArray(o[k]))) return null
  return {
    tasks: list(o.tasks, cleanTask),
    notes: list(o.notes, cleanNote),
    classes: list(o.classes, cleanClass),
    areas: list(o.areas, cleanArea),
    settings: list(o.settings, cleanSetting),
  }
}

/** Одинаковое время правки — выбираем одинаково на всех устройствах: по содержимому. */
export function tieKey(v: unknown): string {
  const sort = (x: any): any =>
    Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x
  return JSON.stringify(sort(v))
}
