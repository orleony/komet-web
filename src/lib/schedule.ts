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

const dayNames: [RegExp, number][] = [
  [/(?<![\p{L}])(?:понедельник\p{L}*|пн)(?![\p{L}])/iu, 1],
  [/(?<![\p{L}])(?:вторник\p{L}*|вт)(?![\p{L}])/iu, 2],
  [/(?<![\p{L}])(?:сред[аыу]|ср)(?![\p{L}])/iu, 3],
  [/(?<![\p{L}])(?:четверг\p{L}*|чт)(?![\p{L}])/iu, 4],
  [/(?<![\p{L}])(?:пятниц\p{L}*|пт)(?![\p{L}])/iu, 5],
  [/(?<![\p{L}])(?:суббот\p{L}*|сб)(?![\p{L}])/iu, 6],
  [/(?<![\p{L}])(?:воскресень\p{L}*|вс)(?![\p{L}])/iu, 7],
]

const kinds: [RegExp, string][] = [
  [/(?<![\p{L}])(?:лаб(?:\.|а|ы|ораторн\p{L}*)?(?:\s+работ\p{L}*)?|л\/р|лр)(?![\p{L}])/iu, 'Лабораторная работа'],
  [/(?<![\p{L}])(?:лек(?:\.|ци\p{L}*)?|лк)(?![\p{L}])/iu, 'Лекция'],
  // «Практическая психология» — это предмет, а «практическое занятие» — вид
  [/(?<![\p{L}])(?:практ(?:\.|ик[аеиоуй]?|ическ\p{L}*\s+занят\p{L}*)?|пр\.?|пз)(?![\p{L}])/iu, 'Практика'],
  [/(?<![\p{L}])(?:сем(?:\.|инар\p{L}*)?)(?![\p{L}])/iu, 'Семинар'],
  [/(?<![\p{L}])(?:консульт\p{L}*)(?![\p{L}])/iu, 'Консультация'],
  [/(?<![\p{L}])(?:экзамен\p{L}*)(?![\p{L}])/iu, 'Экзамен'],
  [/(?<![\p{L}])(?:зач(?:\.|[её]т\p{L}*)?)(?![\p{L}])/iu, 'Зачёт'],
]

// Слово «неделя» уходит вместе с признаком: «(нечётная неделя)» не оставляет «( неделя»
const week = '(?:\\s+недел\\p{L}*)?'
const parities: [RegExp, WeekParity][] = [
  [new RegExp(`(?<![\\p{L}])(?:по\\s+)?(?:нечетн\\p{L}*|нечётн\\p{L}*|числ(?:\\.|итель\\p{L}*)?|верхн\\p{L}*|ч\\/н|1\\s*нед\\p{L}*\\.?)${week}(?![\\p{L}])|\\((?:ч|числ)\\)`, 'iu'), 'numerator'],
  [new RegExp(`(?<![\\p{L}])(?:по\\s+)?(?:четн\\p{L}*|чётн\\p{L}*|знам(?:\\.|енател\\p{L}*)?|нижн\\p{L}*|з\\/н|2\\s*нед\\p{L}*\\.?)${week}(?![\\p{L}])|\\((?:з|знам)\\)`, 'iu'), 'denominator'],
]

const time = '(\\d{1,2})\\s*[:.]\\s*(\\d{2})'
const timeRange = new RegExp(`(?:(?<![\\p{L}])с\\s*)?${time}\\s*(?:-|–|—|до)\\s*${time}`, 'u')
const timeStart = new RegExp(`^${time}(?!\\d)`)
const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 }

/** Одна строка расписания — сколько удалось понять (title может быть пустым: «1 пара» на отдельной строке). */
function parseLine(input: string, day: number): ParsedClass {
  let line = input
  const c: ParsedClass = { weekday: day, number: null, startMin: null, endMin: null, title: '', teacher: '', room: '', kind: '', parity: 'every' }

  const range = timeRange.exec(line)
  if (range) {
    c.startMin = Number(range[1]) * 60 + Number(range[2])
    c.endMin = Number(range[3]) * 60 + Number(range[4])
    line = (line.slice(0, range.index) + ' ' + line.slice(range.index + range[0].length)).trim()
  }
  // Подгруппа — в вид занятия: «Лекция · 1 подгр.» (раньше номера пары: «1 подгруппа: Английский»)
  const sub = /\(?\s*(\d)\s*(?:-?\s*я\s*)?(?:подгр\p{L}*|п\/гр?)\.?\s*\)?|\(?\s*(?:подгр\p{L}*|п\/гр?)\.?\s*(\d)\s*\)?/iu.exec(line)
  let subgroup = ''
  if (sub) {
    subgroup = `${sub[1] ?? sub[2]} подгр.`
    line = (line.slice(0, sub.index) + ' ' + line.slice(sub.index + sub[0].length)).replace(/^[\s:,.–—-]+/, '').trim()
  }
  // «1 пара», «1)», «1.», «1-я пара», «I пара»
  const num = /^(\d|i{1,3}|iv|vi{0,3})\s*(?:-?\s*(?:я|ая)\s*)?(?:пара|\)|\.(?!\d)|:|–|—|-)?(?:\s+|$)/iu.exec(line)
  if (num) {
    const raw = num[1].toLowerCase()
    const n = /^\d$/.test(raw) ? Number(raw) : roman[raw]
    // Римское «I» без слова «пара» и без скобки — скорее начало названия («И…» не бывает латиницей, но «V» бывает)
    if (n >= 1 && n <= 9 && (/^\d$/.test(raw) || /пара|\)|\./i.test(num[0]))) {
      c.number = n
      line = line.slice(num[0].length)
    }
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
    if (re.test(line)) {
      c.parity = p
      line = line.replace(re, ' ')
      break
    }
  }
  for (const [re, k] of kinds) {
    if (re.test(line)) {
      c.kind = k
      line = line.replace(re, ' ')
      break
    }
  }
  if (subgroup) c.kind = [c.kind, subgroup].filter(Boolean).join(' · ')
  // Пустые скобки и звёздочки от «[числ]», «*знам*»
  line = line.replace(/\[\s*\]|\*\s*\*/g, ' ')
  line = line.replace(/(?<![\p{L}])(?:онлайн|дистанционно|дист\.?)(?![\p{L}])/iu, (m) => {
    c.room = c.room || m.toLowerCase()
    return ' '
  })

  // Аудитория: «ауд. 301», «каб 5-12», «к. 5-12», «а.301», «корп. 2 ауд. 301»
  line = line.replace(/(?<![\p{L}])корп(?:ус)?\.?\s*\d+\p{L}?/iu, ' ')
  // Одиночные «к»/«а» — только перед цифрой: «Подготовка к ОГЭ-2026» — не аудитория
  const room = /(?<![\p{L}])(?:(?:ауд(?:итория)?|каб(?:инет)?)\.?\s*([\p{L}\d][\p{L}\d\-/]*\d[\p{L}\d\-/]*|\d[\p{L}\d\-/]*)|(?:к|а)\.?\s*(\d[\p{L}\d\-/]*))/iu.exec(line)
  if (room) {
    c.room = room[1] ?? room[2]
    line = line.replace(room[0], ' ')
  }

  // Преподаватели — все: «Иванов И.И., Петров П.П.», «Иванов Иван Иванович», «преп. …»
  line = line.replace(/(?<![\p{L}])(?:ст\.\s*преп|преп(?:одаватель)?|доц(?:ент)?|проф(?:ессор)?|асс(?:истент)?)\.?(?![\p{L}])\s*/giu, ' ')
  const teachers: string[] = []
  const full = /(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)\s+(\p{Lu}\p{Ll}+)\s+(\p{Lu}\p{Ll}+(?:вич|вна|ична|ич|ьич|кызы|оглы))(?![\p{L}])/gu
  line = line.replace(full, (_m, a, b, d) => {
    teachers.push(`${a} ${b} ${d}`)
    return ' '
  })
  // «И.И. Иванов» — инициалы впереди
  line = line.replace(/(?<![\p{L}])(\p{Lu})\.\s?(\p{Lu})\.\s?(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)(?![\p{L}])(?!\s*\p{Lu}\.)/gu, (_m, b, d, a) => {
    teachers.push(`${a} ${b}.${d}.`)
    return ' '
  })
  const initials = /(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)\s+(\p{Lu})\.\s?(\p{Lu})\.?/gu
  line = line.replace(initials, (_m, a, b, d) => {
    teachers.push(`${a} ${b}.${d}.`)
    return ' '
  })
  c.teacher = teachers.join(', ')

  // Остатки от вырезанного: «( )», «, ,», хвостовые разделители
  line = line.replace(/\(\s*[,;.]?\s*\)/g, ' ').replace(/(?:\s*[,;]\s*){2,}/g, ', ').replace(/[\s,;.–—-]+$/, '')

  // Аудитория без «ауд.»: отдельное число вроде 301, 5-12, 301а, Г-301, 301/2 — в конце строки
  if (!c.room) {
    const bare = /(?:^|\s)(\d{2,4}[\p{L}]?(?:\/\d{1,2})?|\d{1,2}-\d{1,3}|[\p{Lu}]-?\d{2,4})\s*$/u.exec(line)
    // Год («ЕГЭ 2026») — не аудитория
    if (bare && !/^(?:19|20)\d{2}$/.test(bare[1])) {
      c.room = bare[1]
      line = line.slice(0, bare.index)
    }
  }

  // Непарные скобки — убираем совсем
  if ((line.match(/\(/g) ?? []).length !== (line.match(/\)/g) ?? []).length) line = line.replace(/[()]/g, ' ')
  c.title = line.replace(/[()[\],;–—-]+\s*$/, '').replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim()
  if (!/\p{L}{2,}/u.test(c.title)) c.title = ''
  // Перерыв и обед — не пары
  if (/^(?:большой\s+)?(?:перерыв|перемена|обед)$/iu.test(c.title)) c.title = ''
  return c
}

/** Строка — заголовок дня? Возвращает день и остаток строки (после названия дня и даты). */
function dayHeader(line: string): { day: number; rest: string } | null {
  const dated = line.replace(/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?(?:\s*г\.?)?/g, ' ').replace(/[\s,.:;()–—-]+/g, ' ').trim()
  for (const [re, n] of dayNames) {
    const m = re.exec(line)
    if (!m) continue
    if (m.index === 0) {
      const rest = line.slice(m[0].length).replace(/^[\s.:,–—-]+/, '').replace(/^\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?(?:\s*г\.?)?\s*/, '').replace(/^[\s.:,–—-]+/, '')
      return { day: n, rest }
    }
    if (re.test(dated) && dated.replace(re, '').trim() === '') return { day: n, rest: '' }
  }
  return null
}

const cleanLine = (raw: string) => raw.replace(/[\t•·|]+/g, ' ').replace(/^[^\p{L}\p{N}(]+/u, '').replace(/\s+/g, ' ').trim()

/** Строка — только признак недели («Числитель», «(знам.)», «Чётная неделя»)? */
function parityOnly(line: string): WeekParity | null {
  for (const [re, p] of parities) {
    if (re.test(line) && !line.replace(re, ' ').replace(/[\s()[\]*:.,;–—-]+/g, '')) return p
  }
  return null
}

/** Разбирает вставленное расписание: заголовки дней (в т. ч. с датой), «1 пара», время, вид занятия, аудитория,
 *  преподаватели, числитель/знаменатель (и разделами «Нечётная неделя … Чётная неделя …»).
 *  Понимает и «одно поле на строку», как на многих сайтах вузов. bells — общие звонки или звонки по дням. */
export function parseScheduleText(text: string, bells: BellSlot[] | ((day: number) => BellSlot[]) = []): ParsedClass[] {
  const bellsOf = typeof bells === 'function' ? bells : () => bells
  const out: ParsedClass[] = []
  let day: number | null = null
  /** «1 пара» / «08:30-10:00» на отдельной строке — ждём, что ниже будет предмет */
  let pending: ParsedClass | null = null
  let last: ParsedClass | null = null
  /** Раздел «Нечётная неделя» — для всех дней ниже; «Понедельник (числитель)» — до следующего дня */
  let sectionParity: WeekParity | null = null
  let dayParity: WeekParity | null = null
  /** Пары, которым признак недели достался от раздела или дня (их уточняет строка «числ.» ниже) */
  const inherited = new Set<ParsedClass>()

  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean)
  lines.forEach((raw, index) => {
    let line = raw
    const nextIsDay = index + 1 < lines.length && dayHeader(lines[index + 1]) != null

    // Заголовок дня: «Понедельник», «ПН, 09.11», «09.11.2026 Понедельник», «Пн 1 Матан», «Понедельник (числитель)»
    const header = dayHeader(line)
    if (header) {
      day = header.day
      pending = null
      last = null
      dayParity = null
      line = header.rest
      if (!line) return
      const p = parityOnly(line)
      if (p) {
        dayParity = p
        return
      }
    }

    // «Нечётная неделя» отдельной строкой — раздел расписания, а не поле последней пары
    const p = parityOnly(line)
    if (p && !pending && (!last || nextIsDay || (/недел/iu.test(line) && !/[()]/.test(line)))) {
      sectionParity = p
      dayParity = null
      pending = null
      last = null
      return
    }
    if (day == null) return

    const c = parseLine(line, day)
    if (c.title) {
      if (pending && c.number == null && c.startMin == null) {
        c.number = pending.number
        c.startMin = pending.startMin
        c.endMin = pending.endMin
      }
      if (pending?.parity && pending.parity !== 'every' && c.parity === 'every') c.parity = pending.parity
      if (c.parity === 'every' && (dayParity ?? sectionParity)) {
        c.parity = (dayParity ?? sectionParity)!
        inherited.add(c)
      }
      pending = null
      out.push(c)
      last = c
    } else if (c.number != null || c.startMin != null) {
      if (last && last.startMin == null && last.number == null && c.number == null && c.startMin != null) {
        // Время под предметом: «Матан / 08:30-10:00 / ауд. 305» — это время Матана
        last.startMin = c.startMin
        last.endMin = c.endMin
        if (!last.room && c.room) last.room = c.room
        return
      }
      // Новая пара начинается: дальше будут её поля
      if (pending && pending.startMin == null && c.startMin != null && c.number == null) {
        pending.startMin = c.startMin
        pending.endMin = c.endMin
      } else pending = c
      last = null
    } else if (last) {
      // «лекция», «ауд. 301», «Иванов И.И.», «2 подгр.» на своих строках — к последней паре
      if (c.kind) {
        if (!last.kind) last.kind = c.kind
        else if (/подгр/.test(c.kind) && !/подгр/.test(last.kind)) last.kind = `${last.kind} · ${c.kind}`
      }
      if (!last.room && c.room) last.room = c.room
      if (!last.teacher && c.teacher) last.teacher = c.teacher
      if ((last.parity === 'every' || inherited.has(last)) && c.parity !== 'every') {
        last.parity = c.parity
        inherited.delete(last)
      }
    } else if (pending) {
      if (c.parity !== 'every') pending.parity = c.parity
    }
  })

  for (const c of out) {
    const own = bellsOf(c.weekday)
    // Время по звонкам, если указан только номер (или наоборот)
    if (c.startMin == null && c.number != null && own[c.number - 1]) {
      c.startMin = own[c.number - 1].start
      c.endMin = own[c.number - 1].end
    }
    if (c.number == null && c.startMin != null) {
      const i = slotIndex(own, c.startMin)
      if (i != null) c.number = i + 1
    }
    if (c.startMin != null && c.endMin == null) {
      const i = slotIndex(own, c.startMin)
      c.endMin = i != null ? own[i].end : c.startMin + 90
    }
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
  allDay: boolean
  cancelled: boolean
}

function icsDate(value: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
  // С TZID или без — считаем местным временем телефона (расписание вуза — в его поясе)
  return new Date(+y, +mo - 1, +d, +h, +mi, +s)
}

/** «PT1H30M» → минуты */
function icsDuration(value: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value.trim())
  if (!m) return null
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)
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
  // Пробелы в конце убираем только после склейки: «Математический␠» + «анализ»
  for (let i = 0; i < unfolded.length; i++) unfolded[i] = unfolded[i].replace(/\s+$/, '')
  const events: IcsEvent[] = []
  let cur: (Partial<IcsEvent> & { duration?: number }) | null = null
  /** Вложенные блоки (VALARM и т. п.) — их поля не наши */
  let nested = 0
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') {
      cur = { summary: '', location: '', description: '', rrule: '', allDay: false, cancelled: false }
      nested = 0
    } else if (line === 'END:VEVENT') {
      if (cur?.start && !cur.end && cur.duration != null) cur.end = new Date(cur.start.getTime() + cur.duration * 60_000)
      if (cur?.start && cur.end) events.push(cur as IcsEvent)
      cur = null
    } else if (cur && line.startsWith('BEGIN:')) nested++
    else if (cur && line.startsWith('END:')) nested = Math.max(0, nested - 1)
    else if (cur && nested === 0) {
      const i = line.indexOf(':')
      if (i < 0) continue
      const [name, ...params] = line.slice(0, i).split(';')
      const value = line.slice(i + 1)
      const isDate = params.some((p) => p.toUpperCase() === 'VALUE=DATE') || /^\d{8}$/.test(value.trim())
      if (name === 'DTSTART') {
        cur.start = icsDate(value) ?? undefined
        if (isDate) cur.allDay = true
      } else if (name === 'DTEND') cur.end = icsDate(value) ?? undefined
      else if (name === 'DURATION') cur.duration = icsDuration(value) ?? undefined
      else if (name === 'SUMMARY') cur.summary = unescape(value)
      else if (name === 'LOCATION') cur.location = unescape(value)
      else if (name === 'DESCRIPTION') cur.description = unescape(value)
      else if (name === 'RRULE') cur.rrule = value
      else if (name === 'STATUS' && value.trim().toUpperCase() === 'CANCELLED') cur.cancelled = true
    }
  }
  return events
}

const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes()
const isoDay = (d: Date) => ((d.getDay() + 6) % 7) + 1
const icsDays: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }

/** События календаря → пары недели. parityOf — какая неделя (числитель/знаменатель) у даты.
 *  Каникулы (на весь день), отменённые и разовые события не берём. */
export function parseICS(text: string, parityOf: (d: Date) => WeekParity, bells: BellSlot[] = [], now = new Date()): ParsedClass[] {
  const groups = new Map<string, { e: IcsEvent; weekday: number; parities: Set<WeekParity>; count: number; repeating: boolean }>()
  for (const e of parseICSEvents(text)) {
    if (e.allDay || e.cancelled) continue
    // Прошлый семестр (повтор уже закончился) и «повтор» из одного раза — не берём
    const until = /UNTIL=(\d{8}(?:T\d{6}Z?)?)/.exec(e.rrule)
    if (until && (icsDate(until[1])?.getTime() ?? Infinity) < now.getTime()) continue
    if (/COUNT=1(?!\d)/.test(e.rrule)) e.rrule = ''
    const interval = /INTERVAL=(\d+)/.exec(e.rrule)
    const weekly = /FREQ=WEEKLY/.test(e.rrule)
    const byDay = /BYDAY=([A-Z,]+)/.exec(e.rrule)?.[1].split(',').map((d) => icsDays[d]).filter(Boolean)
    const weekdays = weekly && byDay?.length ? byDay : [isoDay(e.start)]
    for (const weekday of weekdays) {
      const key = [weekday, minutes(e.start), minutes(e.end), e.summary, e.location].join('|')
      const g = groups.get(key) ?? { e, weekday, parities: new Set<WeekParity>(), count: 0, repeating: false }
      g.count++
      if (weekly) g.repeating = true
      if (weekly && (!interval || interval[1] === '1')) {
        g.parities.add('numerator')
        g.parities.add('denominator')
      } else g.parities.add(parityOf(e.start))
      groups.set(key, g)
    }
  }
  const out: ParsedClass[] = []
  for (const { e, weekday, parities: ps, count, repeating } of groups.values()) {
    if (!repeating && count < 2) continue
    // Вид занятия, аудитория и препод — из названия; из описания берём только препода и вид, не текст
    const fromTitle = parseLine(e.summary, weekday)
    const fromDescription = e.description ? parseLine(e.description, weekday) : null
    const start = minutes(e.start)
    const i = slotIndex(bells, start)
    out.push({
      weekday,
      number: i != null ? i + 1 : null,
      startMin: start,
      endMin: minutes(e.end),
      title: fromTitle.title || e.summary,
      teacher: fromTitle.teacher || fromDescription?.teacher || '',
      room: e.location || fromTitle.room || '',
      kind: fromTitle.kind || fromDescription?.kind || '',
      parity: ps.size === 2 ? 'every' : [...ps][0],
    })
  }
  return out.sort((a, b) => a.weekday - b.weekday || (a.startMin ?? 0) - (b.startMin ?? 0))
}
