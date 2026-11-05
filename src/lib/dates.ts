// Даты по-русски. Неделя начинается с понедельника. Все «дни» — полночь по местному времени.

export const weekdayNames = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
export const weekdayShort = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const monthsGen = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const monthsShort = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function startOfToday(now = new Date()): Date {
  return startOfDay(now)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds())
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate())
}

export function dayOffset(n: number, now = new Date()): Date {
  return addDays(startOfToday(now), n)
}

/** 1 — понедельник … 7 — воскресенье. */
export function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1
}

export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -(isoWeekday(d) - 1))
}

/** Воскресенье текущей недели. */
export function endOfWeek(now = new Date()): Date {
  return addDays(startOfWeek(now), 6)
}

/** Ближайший такой день недели строго после сегодняшнего. */
export function nextWeekday(iso: number, now = new Date()): Date {
  const today = startOfToday(now)
  let diff = iso - isoWeekday(today)
  if (diff <= 0) diff += 7
  return addDays(today, diff)
}

/** Сколько дней до даты: 0 — сегодня, отрицательное — просрочено. */
export function daysLeft(d: Date, now = new Date()): number {
  return Math.round((startOfDay(d).getTime() - startOfToday(now).getTime()) / 86_400_000)
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

export function time(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`
  return minutes % 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${Math.floor(minutes / 60)} ч`
}

/** plural(3, "день", "дня", "дней") → «дня». */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = Math.abs(n) % 10
  const n100 = Math.abs(n) % 100
  if (n10 === 1 && n100 !== 11) return one
  if (n10 >= 2 && n10 <= 4 && !(n100 >= 12 && n100 <= 14)) return few
  return many
}

export function dayMonth(d: Date): string {
  return `${d.getDate()} ${monthsGen[d.getMonth()]}`
}

export function shortDate(d: Date): string {
  return `${d.getDate()} ${monthsShort[d.getMonth()]}`
}

/** «31 октября — суббота» */
export function dayHeader(d: Date): string {
  return `${dayMonth(d)} — ${weekdayNames[isoWeekday(d) - 1].toLowerCase()}`
}

/** «Среда, 4 ноября» */
export function todayTitle(now = new Date()): string {
  return `${weekdayNames[isoWeekday(now) - 1]}, ${dayMonth(now)}`
}

export function relativeDay(d: Date, now = new Date()): string {
  const diff = daysLeft(d, now)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  if (diff === -1) return 'Вчера'
  return shortDate(d)
}

/** Секунды с 1970 (как хранит Mac) ↔ Date */
export const toDate = (s: number | null | undefined): Date | null => (s == null ? null : new Date(s * 1000))
export const toSec = (d: Date | null | undefined): number | null => (d == null ? null : d.getTime() / 1000)
export const nowSec = () => Date.now() / 1000
