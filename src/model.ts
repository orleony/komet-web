// Те же поля, что в Mac-версии (даты — секунды с 1970): файл экспорта с Mac открывается здесь как есть.

export enum Priority {
  Normal = 0,
  Important = 1,
  Urgent = 2,
}

export const priorityTitle: Record<Priority, string> = {
  [Priority.Normal]: 'Обычная',
  [Priority.Important]: 'Важная',
  [Priority.Urgent]: 'Срочная',
}

export interface Area {
  id: string
  title: string
  /** Имя значка (как SF Symbols на Mac) */
  icon: string
  colorIndex: number
  /** Слова через запятую */
  keywords: string
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
  /** Из какого готового раздела создан (study, sport…) — от этого зависят встроенные знания */
  template?: string | null
}

export interface TaskItem {
  id: string
  title: string
  details: string
  areaID: string
  dueDate?: number | null
  /** Время в минутах от полуночи («в 18:00» → 1080); null — весь день. Дата — в dueDate. */
  dueTime?: number | null
  isDone: boolean
  doneAt?: number | null
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
  priority: Priority
  trashedAt?: number | null
}

export interface Note {
  id: string
  /** Текст без оформления: заголовок, поиск, превью */
  text: string
  kind: 'note'
  isPinned: boolean
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
  audioFile?: string | null
  /** RTF с Mac — здесь не показывается, сохраняется для обратного переноса */
  rich?: string | null
  /** Оформленный текст веб-версии */
  html?: string | null
  trashedAt?: number | null
}

export type WeekParity = 'every' | 'numerator' | 'denominator'

export const parityTitle: Record<WeekParity, string> = {
  every: 'Каждую неделю',
  numerator: 'Числитель',
  denominator: 'Знаменатель',
}

export interface ClassSlot {
  id: string
  /** 1 — понедельник … 7 — воскресенье */
  weekday: number
  /** Минуты от начала дня: 9:30 → 570 */
  startMin: number
  endMin: number
  title: string
  teacher: string
  room: string
  kind: string
  parity: WeekParity
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}

export interface SyncSetting {
  id: string
  value?: string | null
  updatedAt: number
}

/** Всё содержимое — как SyncSnapshot на Mac */
export interface Snapshot {
  tasks: TaskItem[]
  notes: Note[]
  classes: ClassSlot[]
  areas: Area[]
  settings: SyncSetting[]
}

export const uuid = () => crypto.randomUUID().toUpperCase()
