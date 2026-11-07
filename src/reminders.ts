// Какие напоминания нужны на неделю вперёд — те же правила, что у Notifier на Mac.
import { addDays, daysLeft, plural, startOfDay, startOfToday, time, toDate } from './lib/dates'
import * as store from './store'

export interface Reminder {
  /** Секунды с 1970 */
  at: number
  title: string
  body: string
  tag: string
}

const LIMIT = 100

export function buildReminders(now = new Date()): Reminder[] {
  const p = store.prefs.value
  const items: Reminder[] = []
  const at = (day: Date, minutes: number) => startOfDay(day).getTime() / 1000 + minutes * 60
  const plan = store.plan()

  // Неделя (числитель/знаменатель) не выбрана — напоминаем только о парах «каждую неделю», иначе придут обе сразу
  const parityKnown = store.weekParity(now) != null
  for (let offset = 0; offset < 7; offset++) {
    const day = addDays(startOfToday(now), offset)
    const classes = store.classesOn(day).filter((c) => parityKnown || c.parity === 'every')

    if (p.morning) {
      const dueToday = plan.filter((t) => daysLeft(toDate(t.dueDate)!, now) <= offset)
      const parts: string[] = []
      // В сводке — пары, которые ещё впереди на момент сводки
      const ahead = classes.filter((c) => c.startMin >= p.morningTime)
      if (ahead.length) {
        parts.push(`${ahead.length} ${plural(ahead.length, 'пара', 'пары', 'пар')}, первая в ${time(ahead[0].startMin)} — ${ahead[0].title}`)
      }
      if (dueToday.length) parts.push('Горит: ' + dueToday.slice(0, 2).map((t) => t.title).join(', '))
      if (parts.length) items.push({ at: at(day, p.morningTime), title: 'Доброе утро', body: parts.join(' · '), tag: `morning-${offset}` })
    }

    if (p.classes) {
      for (const c of classes) {
        items.push({
          at: at(day, c.startMin - p.classLead),
          title: `Через ${p.classLead} мин: ${c.title}`,
          body: [c.kind, c.room, c.teacher].filter(Boolean).join(' · '),
          tag: `class-${offset}-${c.id}`,
        })
      }
    }
  }

  if (p.deadlines) {
    for (const t of plan) {
      const due = toDate(t.dueDate)!
      const area = store.areaOf(t).title
      // Заголовок — когда срок и раздел, текст — сама задача
      if (p.deadlineWhen !== 'same') items.push({ at: at(due, p.deadlineTime - 24 * 60), title: `Завтра срок · ${area}`, body: t.title, tag: `due-${t.id}` })
      if (p.deadlineWhen !== 'before') items.push({ at: at(due, p.deadlineTime), title: `Сегодня срок · ${area}`, body: t.title, tag: `due-today-${t.id}` })
    }
  }

  const nowSec = now.getTime() / 1000
  return items.filter((r) => r.at > nowSec).sort((a, b) => a.at - b.at).slice(0, LIMIT)
}
