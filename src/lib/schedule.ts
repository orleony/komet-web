// Расписание: звонки, номер пары, разбор вставленного текста и файла календаря (.ics).
import type { WeekParity } from '../model'

// MARK: - Звонки

export interface BellSlot {
  start: number
  end: number
}

export interface BellParams {
  /** Начало первой пары, минуты от полуночи */
  first: number
  /** Длительность пары, мин */
  length: number
  /** Обычная перемена, мин */
  pause: number
  /** После какой пары большой перерыв; 0 — нет */
  bigAfter: number
  bigPause: number
  /** Сколько пар бывает максимум */
  count: number
}

export const defaultBellParams: BellParams = { first: 9 * 60, length: 90, pause: 10, bigAfter: 2, bigPause: 40, count: 6 }

export function computeBells(p: BellParams): BellSlot[] {
  const slots: BellSlot[] = []
  let t = p.first
  for (let i = 1; i <= p.count; i++) {
    slots.push({ start: t, end: t + p.length })
    t += p.length + (i === p.bigAfter ? p.bigPause : p.pause)
  }
  return slots
}

/** Номер пары (с нуля) по времени начала; null — пара не по звонкам. */
export function slotIndex(bells: BellSlot[], startMin: number): number | null {
  let best: number | null = null
  let bestDiff = Infinity
  bells.forEach((b, i) => {
    const diff = Math.abs(b.start - startMin)
    if (diff < bestDiff) {
      best = i
      bestDiff = diff
    }
  })
  return bestDiff <= 15 ? best : null
}

/** Подбирает звонки по уже введённым парам (например, перенесённым с Mac). */
export function inferBells(starts: { startMin: number; endMin: number }[]): BellSlot[] {
  const unique = new Map<number, number>()
  for (const s of starts) if (!unique.has(s.startMin)) unique.set(s.startMin, s.endMin)
  return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([start, end]) => ({ start, end }))
}

// MARK: - Разбор текста

export interface ParsedClass {
  weekday: number
  /** Номер пары с единицы, если указан */
  number: number | null
  startMin: number | null
  endMin: number | null
  title: string
  teacher: string
  room: string
  kind: string
  parity: WeekParity
}

const days: [RegExp, number][] = [
  [/^(?:понедельник\p{L}*|пн)(?![\p{L}])/iu, 1],
  [/^(?:вторник\p{L}*|вт)(?![\p{L}])/iu, 2],
  [/^(?:сред[аыу]|ср)(?![\p{L}])/iu, 3],
  [/^(?:четверг\p{L}*|чт)(?![\p{L}])/iu, 4],
  [/^(?:пятниц\p{L}*|пт)(?![\p{L}])/iu, 5],
  [/^(?:суббот\p{L}*|сб)(?![\p{L}])/iu, 6],
  [/^(?:воскресень\p{L}*|вс)(?![\p{L}])/iu, 7],
]

const kinds: [RegExp, string][] = [
  [/(?<![\p{L}])(?:лаб(?:\.|ораторн\p{L}*)?(?:\s+работ\p{L}*)?|л\/р|лр)(?![\p{L}])/iu, 'Лабораторная работа'],
  [/(?<![\p{L}])(?:лек(?:\.|ци\p{L}*)?|лк)(?![\p{L}])/iu, 'Лекция'],
  [/(?<![\p{L}])(?:практ(?:\.|ик\p{L}*|ическ\p{L}*(?:\s+занят\p{L}*)?)?|пр\.?|пз)(?![\p{L}])/iu, 'Практика'],
  [/(?<![\p{L}])(?:сем(?:\.|инар\p{L}*)?)(?![\p{L}])/iu, 'Семинар'],
  [/(?<![\p{L}])(?:консульт\p{L}*)(?![\p{L}])/iu, 'Консультация'],
  [/(?<![\p{L}])(?:экзамен\p{L}*)(?![\p{L}])/iu, 'Экзамен'],
  [/(?<![\p{L}])(?:зач(?:\.|[её]т\p{L}*)?)(?![\p{L}])/iu, 'Зачёт'],
]

const parities: [RegExp, WeekParity][] = [
  [/(?<![\p{L}])(?:нечетн\p{L}*|нечётн\p{L}*|числ(?:\.|итель\p{L}*)?|верхн\p{L}*|ч\/н|1\s*нед\p{L}*\.?)(?![\p{L}])|\((?:ч|числ)\)/iu, 'numerator'],
  [/(?<![\p{L}])(?:четн\p{L}*|чётн\p{L}*|знам(?:\.|енател\p{L}*)?|нижн\p{L}*|з\/н|2\s*нед\p{L}*\.?)(?![\p{L}])|\((?:з|знам)\)/iu, 'denominator'],
]

const time = '(\\d{1,2})[:.](\\d{2})'
const timeRange = new RegExp(`${time}\\s*(?:-|–|—|до)\\s*${time}`)
const timeStart = new RegExp(`^${time}(?!\\d)`)

/** Разбирает вставленное расписание: заголовки дней, «1 пара», время, вид занятия, аудитория, препод, числитель. */
export function parseScheduleText(text: string, bells: BellSlot[] = []): ParsedClass[] {
  const out: ParsedClass[] = []
  let day: number | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/[•·|]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!line) continue

    // День недели в начале строки — заголовок или «Пн 1 Матан»
    for (const [re, n] of days) {
      const m = re.exec(line)
      if (m) {
        day = n
        line = line.slice(m[0].length).replace(/^[\s.:,–—-]+/, '')
        break
      }
    }
    if (!line || day == null) continue

    const c: ParsedClass = { weekday: day, number: null, startMin: null, endMin: null, title: '', teacher: '', room: '', kind: '', parity: 'every' }

    const range = timeRange.exec(line)
    if (range) {
      c.startMin = Number(range[1]) * 60 + Number(range[2])
      c.endMin = Number(range[3]) * 60 + Number(range[4])
      line = (line.slice(0, range.index) + ' ' + line.slice(range.index + range[0].length)).trim()
    }
    // «1 пара», «1)», «1.», «I пара»
    const num = /^(\d)\s*(?:-?\s*(?:я|ая)\s*)?(?:пара|\)|\.(?!\d)|:|–|—|-)?\s+/iu.exec(line)
    if (num && Number(num[1]) >= 1 && Number(num[1]) <= 9) {
      c.number = Number(num[1])
      line = line.slice(num[0].length)
    }
    if (c.startMin == null) {
      const start = timeStart.exec(line)
      if (start) {
        c.startMin = Number(start[1]) * 60 + Number(start[2])
        line = line.slice(start[0].length)
      }
    }
    line = line.replace(/(?<![\p{L}])пара(?![\p{L}])/iu, ' ')

    for (const [re, p] of parities) {
      const m = re.exec(line)
      if (m) {
        c.parity = p
        line = line.replace(re, ' ')
        break
      }
    }
    for (const [re, k] of kinds) {
      const m = re.exec(line)
      if (m) {
        c.kind = k
        line = line.replace(re, ' ')
        break
      }
    }

    // Аудитория: «ауд. 301», «каб 5-12», «а.301»
    const room = /(?<![\p{L}])(?:ауд(?:итория)?|каб(?:инет)?|к|а)\.?\s*([\p{L}\d][\p{L}\d\-/]*\d[\p{L}\d\-/]*|\d[\p{L}\d\-/]*)/iu.exec(line)
    if (room) {
      c.room = room[1]
      line = line.replace(room[0], ' ')
    }

    // Преподаватель: «Иванов И.И.», «Иванов И. И.», «Иванов Иван Иванович», «преп. …»
    line = line.replace(/(?<![\p{L}])(?:преп(?:одаватель)?|доц|проф|ст\.\s*преп)\.?\s*/iu, ' ')
    const initials = /(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)\s+(\p{Lu})\.\s?(\p{Lu})\.?/u.exec(line)
    const full = /(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)\s+(\p{Lu}\p{Ll}+)\s+(\p{Lu}\p{Ll}+(?:вич|вна|ична|ич|ьич|ична|кызы|оглы))(?![\p{L}])/u.exec(line)
    const teacher = full ?? initials
    if (teacher) {
      c.teacher = full ? `${full[1]} ${full[2]} ${full[3]}` : `${initials![1]} ${initials![2]}.${initials![3]}.`
      line = line.replace(teacher[0], ' ')
    }

    // Остатки от вырезанного: «( )», «, ,», хвостовые разделители
    line = line.replace(/\(\s*[,;.]?\s*\)/g, ' ').replace(/(?:\s*[,;]\s*){2,}/g, ', ').replace(/[\s,;.–—-]+$/, '')

    // Аудитория без «ауд.»: отдельное число вроде 301, 5-12, 301а — в конце строки
    if (!c.room) {
      const bare = /(?:^|\s)(\d{2,4}[\p{L}]?|\d{1,2}-\d{1,3}|[\p{Lu}]-?\d{2,4})\s*$/u.exec(line)
      if (bare) {
        c.room = bare[1]
        line = line.slice(0, bare.index)
      }
    }

    // Непарные скобки — убираем совсем
    if ((line.match(/\(/g) ?? []).length !== (line.match(/\)/g) ?? []).length) line = line.replace(/[()]/g, ' ')
    c.title = line.replace(/[()[\],;–—-]+\s*$/, '').replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim()
    if (!/\p{L}{2,}/u.test(c.title)) continue

    // Время по звонкам, если указан только номер (или наоборот)
    if (c.startMin == null && c.number != null && bells[c.number - 1]) {
      c.startMin = bells[c.number - 1].start
      c.endMin = bells[c.number - 1].end
    }
    if (c.number == null && c.startMin != null) {
      const i = slotIndex(bells, c.startMin)
      if (i != null) c.number = i + 1
    }
    if (c.startMin != null && c.endMin == null) {
      const i = slotIndex(bells, c.startMin)
      c.endMin = i != null ? bells[i].end : c.startMin + 90
    }
    out.push(c)
  }
  return out
}

// MARK: - Календарь (.ics)

interface IcsEvent {
  start: Date
  end: Date
  summary: string
  location: string
  description: string
  rrule: string
}

function icsDate(value: string, params: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
  // С TZID или без — считаем местным временем телефона (расписание вуза — в его поясе)
  void params
  return new Date(+y, +mo - 1, +d, +h, +mi, +s)
}

const unescape = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()

export function parseICSEvents(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  // Перенесённые строки начинаются с пробела
  const unfolded: string[] = []
  for (const l of lines) {
    if (/^[ \t]/.test(l) && unfolded.length) unfolded[unfolded.length - 1] += l.slice(1)
    else unfolded.push(l)
  }
  const events: IcsEvent[] = []
  let cur: Partial<IcsEvent> | null = null
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') cur = { summary: '', location: '', description: '', rrule: '' }
    else if (line === 'END:VEVENT') {
      if (cur?.start && cur.end) events.push(cur as IcsEvent)
      cur = null
    } else if (cur) {
      const i = line.indexOf(':')
      if (i < 0) continue
      const [name, ...params] = line.slice(0, i).split(';')
      const value = line.slice(i + 1)
      if (name === 'DTSTART') cur.start = icsDate(value, params.join(';')) ?? undefined
      else if (name === 'DTEND') cur.end = icsDate(value, params.join(';')) ?? undefined
      else if (name === 'SUMMARY') cur.summary = unescape(value)
      else if (name === 'LOCATION') cur.location = unescape(value)
      else if (name === 'DESCRIPTION') cur.description = unescape(value)
      else if (name === 'RRULE') cur.rrule = value
    }
  }
  return events
}

const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes()
const isoDay = (d: Date) => ((d.getDay() + 6) % 7) + 1

/** События календаря → пары недели. parityOf — какая неделя (числитель/знаменатель) у даты. */
export function parseICS(text: string, parityOf: (d: Date) => WeekParity, bells: BellSlot[] = []): ParsedClass[] {
  const groups = new Map<string, { e: IcsEvent; parities: Set<WeekParity> }>()
  for (const e of parseICSEvents(text)) {
    const interval = /INTERVAL=(\d+)/.exec(e.rrule)
    const weekly = /FREQ=WEEKLY/.test(e.rrule)
    const p = parityOf(e.start)
    const key = [isoDay(e.start), minutes(e.start), minutes(e.end), e.summary, e.location].join('|')
    const g = groups.get(key) ?? { e, parities: new Set<WeekParity>() }
    if (weekly && (!interval || interval[1] === '1')) {
      g.parities.add('numerator')
      g.parities.add('denominator')
    } else g.parities.add(p)
    groups.set(key, g)
  }
  const out: ParsedClass[] = []
  for (const { e, parities: ps } of groups.values()) {
    // Вид занятия и препод — из названия и описания тем же разбором, что и для текста
    const parsed = parseScheduleText(`пн ${e.summary}${e.description ? ' ' + e.description : ''}`, bells)[0]
    const start = minutes(e.start)
    const i = slotIndex(bells, start)
    out.push({
      weekday: isoDay(e.start),
      number: i != null ? i + 1 : null,
      startMin: start,
      endMin: minutes(e.end),
      title: parsed?.title || e.summary,
      teacher: parsed?.teacher ?? '',
      room: e.location || parsed?.room || '',
      kind: parsed?.kind ?? '',
      parity: ps.size === 2 ? 'every' : [...ps][0],
    })
  }
  return out.sort((a, b) => a.weekday - b.weekday || (a.startMin ?? 0) - (b.startMin ?? 0))
}
