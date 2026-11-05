// Разбор фраз — перенос TextProcessor с Mac один в один: чистка, задачи со сроком и важностью, задача или заметка.
import { Priority } from '../model'
import type { Area } from '../model'
import type { AreaTemplate } from './templates'
import { addDays, addMonths, dayOffset, endOfWeek, isoWeekday, nextWeekday, startOfToday, startOfWeek } from './dates'
import { normalize } from './keywords'
import { router } from './router'

export interface TaskSuggestion {
  title: string
  area: Area
  dueDate: Date | null
  priority: Priority
  /** Раздел узнан по словам или моделью, а не взят по умолчанию */
  areaMatched: boolean
  /** Срок взят только из «сегодня» — для дневниковой записи это не дедлайн */
  dueIsWeak: boolean
  /** Похоже на популярный раздел, которого ещё нет */
  suggest?: AreaTemplate
}

export type CaptureKind = 'task' | 'note'

export interface CaptureAnalysis {
  kind: CaptureKind
  tasks: TaskSuggestion[]
}

// MARK: - Регулярки

const cache = new Map<string, RegExp>()
function rx(pattern: string, flags = 'iu'): RegExp {
  const key = flags + pattern
  let r = cache.get(key)
  if (!r) {
    r = new RegExp(pattern, flags)
    cache.set(key, r)
  }
  r.lastIndex = 0
  return r
}
const replace = (s: string, pattern: string, template: string, flags = 'giu') => s.replace(rx(pattern, flags), template)
const test = (s: string, pattern: string) => rx(pattern).test(s)
function groups(s: string, pattern: string): { start: number; end: number; values: (string | undefined)[] } | null {
  const m = rx(pattern).exec(s)
  if (!m) return null
  return { start: m.index, end: m.index + m[0].length, values: m.slice(1) }
}
function split(s: string, pattern: string): string[] {
  return s
    .split(rx(pattern, 'giu'))
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Не буква до и после — граница слова, которая работает с кириллицей. */
const word = (alternatives: string) => `(?<![\\p{L}])(?:${alternatives})(?![\\p{L}])`

const fillers = word('ну|типа|короче|как бы|в общем-то|в общем(?=\\s*[,.!?]|\\s*$)|так сказать|э{2,}|м{2,}|эм+')

const isLetter = (c: string) => /\p{L}/u.test(c)
const isSpace = (c: string) => /\s/.test(c)

// MARK: - Чистка

export function clean(text: string): string {
  let s = text
  s = replace(s, fillers + '[,.]?', '')
  s = replace(s, '(?<![\\p{L}])(\\p{L}+)(?:\\s+\\1)+(?![\\p{L}])', '$1')
  s = replace(s, '[ \\t]{2,}', ' ')
  s = replace(s, '[ \\t]+([,.!?])', '$1')
  s = replace(s, ',{2,}', ',')
  s = replace(s, '([,!?])(?=\\p{L})', '$1 ')
  s = replace(s, '^[ \\t,.]+', '', 'gimu')
  s = s.trim()
  s = capitalizeSentences(s)
  const last = s.slice(-1)
  if (last && (isLetter(last) || /\d/.test(last))) s += '.'
  return s
}

// MARK: - Задачи

const separators =
  '(?:[?;]+|(?<!(?:^|[^\\p{L}])(?:ауд|ул|д|стр|г|кв|корп|каб|пр|т\\.е|т\\.к|им|см|ст|доц|проф|преп|тел|\\p{Lu}))\\.+)(?=\\s|$)|\\n+|(?:,\\s*(?:а\\s+|и\\s+)?|\\s+(?:а|и)\\s+)(?:ещё|еще|также|потом|плюс)(?![\\p{L}])' +
  '|\\s+(?:потом|затем)\\s+(?=\\p{L})'

const leadingWords =
  '^(?:(?:и|а|ну|так|ещё|еще|потом|затем|также|плюс|мне|я|надо бы|надо|нужно бы|нужно|не забыть|не забудь(?:те)?|хочу|хотелось бы|обязательно|должен|должна)(?![\\p{L}])[,\\s]*)+'

const trimChars = (s: string, chars: string) => {
  let a = 0
  let b = s.length
  while (a < b && (chars.includes(s[a]) || isSpace(s[a]))) a++
  while (b > a && (chars.includes(s[b - 1]) || isSpace(s[b - 1]))) b--
  return s.slice(a, b)
}

export function tasksFrom(text: string, hints: string[] = [], now = new Date()): TaskSuggestion[] {
  const cleaned = clean(text)
  const result: TaskSuggestion[] = []
  let carriedDue: Date | null = null
  let carriedPriority = Priority.Normal
  let carriedWeak = false

  for (const piece of split(cleaned, separators)) {
    const box = { title: piece }
    const priority = extractPriority(box)
    const weak = { value: false }
    const due = extractDue(box, weak, now)
    let title = box.title
    title = replace(title, '\\s{2,}', ' ')
    title = replace(title, '\\s+([,.;:])', '$1')
    title = replace(title, ',{2,}', ',')
    title = replace(title, '(?:\\s*,){2,}', ',').trim()
    title = trimChars(replace(title, leadingWords, ''), ' ,.:;-—!')
    title = moveTime(title)
    // Остался один предлог («завтра на») — это не задача
    if ([...title].length < 2 || test(title, '^' + leftovers + '$')) {
      if (due) {
        if (!result.length) {
          carriedDue = due
          carriedWeak = weak.value
        } else if (!result[result.length - 1].dueDate) result[result.length - 1].dueDate = due
      }
      if (priority !== Priority.Normal) {
        if (!result.length) carriedPriority = priority
        else result[result.length - 1].priority = priority
      }
      continue
    }
    const routed = router.route(title, hints)
    result.push({
      title: capitalizeFirst(title),
      area: routed.area,
      dueDate: due ?? carriedDue,
      priority: priority === Priority.Normal ? carriedPriority : priority,
      areaMatched: routed.source.kind !== 'fallback',
      dueIsWeak: due == null ? carriedWeak : weak.value,
      suggest: routed.suggest,
    })
    carriedDue = null
    carriedPriority = Priority.Normal
  }
  return result
}

const leftovers = '(?:на|до|к|ко|в|во|с|со|и|а|по|за|о|об|или)'

/** «В 18:00 сдать лабу» → «сдать лабу в 18:00»: время остаётся, но название начинается с дела. */
export function moveTime(title: string): string {
  const m = groups(title, '^((?:в|во|к|ко|до|с|со)\\s+\\d{1,2}[:.]\\d{2}(?:\\s*(?:-|–|—|до)\\s*\\d{1,2}[:.]\\d{2})?)[,\\s]+(\\p{L}.*)$')
  if (!m) return title
  return `${m.values[1]} ${(m.values[0] ?? '').toLowerCase()}`
}

/** «!!» / «важно» → важная, «!!!» / «срочно» → срочная. «Срочно» остаётся — это ещё и срок «сегодня». */
export function extractPriority(box: { title: string }): Priority {
  let priority = Priority.Normal
  const negated = test(box.title, word('не\\s+(?:очень\\s+)?(?:срочно|важно|важное|важная|критично)'))
  if (test(box.title, '!{3,}') || (!negated && test(box.title, word('срочно|очень важно|критично')))) priority = Priority.Urgent
  else if (test(box.title, '!{2}') || (!negated && test(box.title, word('важно|важное|важная')))) priority = Priority.Important
  box.title = replace(box.title, '\\s*!{2,}', '')
  box.title = replace(box.title, word('(?:это\\s+)?(?:не\\s+)?(?:очень\\s+)?(?:важно|важное|важная|критично)'), '')
  return priority
}

const weekdayForms: [number, string, string, string][] = [
  [1, 'понедельника', 'понедельнику', 'понедельник'],
  [2, 'вторника', 'вторнику', 'вторник'],
  [3, 'среды', 'среде', 'среду'],
  [4, 'четверга', 'четвергу', 'четверг'],
  [5, 'пятницы', 'пятнице', 'пятницу'],
  [6, 'субботы', 'субботе', 'субботу'],
  [7, 'воскресенья', 'воскресенью', 'воскресенье'],
]

const weekdayShortForms = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

const monthsGenitive = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря'

/** Находит срок в тексте и вырезает его. «до субботы» — крайний день пятница, «к субботе» — суббота. */
export function extractDue(box: { title: string }, weak: { value: boolean }, now = new Date()): Date | null {
  const inclusive = test(box.title, word('включительно'))
  box.title = replace(box.title, word('включительно'), '')
  const urgent = test(box.title, '(?<!не\\s)' + word('срочно'))
  box.title = replace(box.title, word('(?:не\\s+|очень\\s+)?срочно'), '')
  const date = findDue(box, inclusive, weak, now)
  if (date) return date
  return urgent ? startOfToday(now) : null
}

function findDue(box: { title: string }, inclusive: boolean, weak: { value: boolean }, now: Date): Date | null {
  const today = startOfToday(now)
  const deadline = (day: Date, exclusive: boolean) => {
    if (!exclusive || inclusive) return day
    const prev = addDays(day, -1)
    return prev < today ? today : prev
  }
  const cut = (m: { start: number; end: number }) => {
    box.title = box.title.slice(0, m.start) + box.title.slice(m.end)
  }

  // «до 5 ноября», «к 12 декабря»
  let m = groups(box.title, '(?:(до|к|на)\\s+)?(?<![\\p{L}\\d])(\\d{1,2})\\s+(' + monthsGenitive + ')(?![\\p{L}])' + '(?:\\s+(\\d{4})(?:\\s*(?:года|год|г\\.?))?)?')
  if (m) {
    const months = monthsGenitive.split('|')
    const day = Number(m.values[1])
    const month = months.indexOf((m.values[2] ?? '').toLowerCase())
    const date = month >= 0 ? makeDate(day, month + 1, m.values[3] ? Number(m.values[3]) : null, today) : null
    if (date) {
      cut(m)
      return deadline(date, m.values[0]?.toLowerCase() === 'до')
    }
  }

  // «до 12.11», «к 05.12.2026». Месяц — две цифры; «в 15.30» — время; после числа не должно быть единиц.
  const units = '(?!\\s*(?:литр\\p{L}*|л|кг|г|гр|км|м|мл|ч|час\\p{L}*|мин\\p{L}*|руб\\p{L}*|р|раз\\p{L}*|шт|%)(?![\\p{L}]))'
  const explicitDay = test(box.title, word('(?:сегодня|завтра|послезавтра)'))
  const range = '(?!\\s*(?:-|–|—|до)\\s*\\d{1,2}[.:]\\d{2})'
  m = explicitDay ? null : groups(box.title, '(?:(до|к|на)\\s+)?(?<![\\p{L}\\d.])(?<!верси[яиюей]\\s)(?<!в\\s)(?<!во\\s)(?<!с\\s)(?<!со\\s)(\\d{1,2})\\.(\\d{2})(?:\\.(\\d{2}|\\d{4}))?(?![\\d.])' + units + range)
  if (m) {
    const date = makeDate(Number(m.values[1]), Number(m.values[2]), m.values[3] ? Number(m.values[3]) : null, today)
    if (date) {
      cut(m)
      return deadline(date, m.values[0]?.toLowerCase() === 'до')
    }
  }

  // «через 3 дня», «через 2 недели»
  m = groups(box.title, word('через\\s+(\\d{1,4}|пару)\\s+(дн\\p{L}*|день|недел\\p{L}*|месяц\\p{L}*)'))
  if (m) {
    const n = (m.values[0] ?? '').toLowerCase() === 'пару' ? 2 : Number(m.values[0] ?? 0)
    const unit = (m.values[1] ?? '').toLowerCase()
    cut(m)
    if (unit.startsWith('месяц')) return addMonths(today, Math.min(n, 120))
    return addDays(today, Math.min(unit.startsWith('недел') ? n * 7 : n, 3650))
  }

  const relative: [string, () => Date][] = [
    [word('(?:(?:к|до|на)\\s+)?послезавтра'), () => dayOffset(2, now)],
    [word('(?:(?:к|до|на)\\s+)?завтра'), () => dayOffset(1, now)],
    [word('(?:на\\s+)?сегодня'), () => today],
    // «Завтрашний» — срок, только если «сегодня»/«завтра» не сказано прямо:
    // «сегодня посмотреть расписание на завтрашний день» — это на сегодня
    [word('(?:(?:к|до|на)\\s+)?завтрашн\\p{L}*(?:\\s+день)?'), () => dayOffset(1, now)],
    [word('через неделю'), () => dayOffset(7, now)],
    [word('через две недели'), () => dayOffset(14, now)],
    [word('через месяц'), () => addMonths(today, 1)],
    [word('на следующей неделе'), () => addDays(endOfWeek(now), 7)],
    [word('(?:на|до конца) (?:этой )?недел[еи]|на неделе'), () => endOfWeek(now)],
    [word('(?:до|к) конц[ау] месяца|в конце месяца'), () => new Date(today.getFullYear(), today.getMonth() + 1, 0)],
    [word('на выходных'), () => (isoWeekday(today) >= 6 ? today : nextWeekday(6, now))],
  ]
  for (const [pattern, date] of relative) {
    if (test(box.title, pattern)) {
      box.title = replace(box.title, pattern, '')
      weak.value = pattern.includes('сегодня')
      return date()
    }
  }

  for (const [iso, gen, dat, acc] of weekdayForms) {
    // «в следующий вторник» — вторник следующей недели
    let w = groups(box.title, word('(?:в|во|на|к|ко|до)?\\s*следующ(?:ий|ую|ее|ему|ей|его)\\s+(?:' + acc + '|' + dat + '|' + gen + ')'))
    if (w) {
      cut(w)
      return addDays(startOfWeek(now), 7 + iso - 1)
    }
    w = groups(box.title, word('до\\s+' + gen))
    if (w) {
      cut(w)
      return deadline(nextWeekday(iso, now), true)
    }
    w = groups(box.title, word('(?:к|ко)\\s+' + dat))
    if (w) {
      cut(w)
      return nextWeekday(iso, now)
    }
    w = groups(box.title, word('(?:в|во|на)\\s+(?:' + acc + '|' + weekdayShortForms[iso - 1] + ')'))
    if (w) {
      cut(w)
      return nextWeekday(iso, now)
    }
  }
  return null
}

function makeDate(day: number, month: number, year: number | null, today: Date): Date | null {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null
  let y = year ?? today.getFullYear()
  if (y < 100) y += 2000
  const valid = (yy: number) => {
    const d = new Date(yy, month - 1, day)
    return d.getDate() === day && d.getMonth() === month - 1 ? d : null
  }
  if (year != null) return valid(y)
  // Без года — ближайшая такая дата впереди (29 февраля — в ближайший високосный)
  for (let yy = y; yy <= y + 8; yy++) {
    const d = valid(yy)
    if (d && d >= today) return d
  }
  return null
}

// MARK: - Задача или заметка

const actionLead = new Set(['и', 'а', 'ну', 'так', 'ещё', 'еще', 'мне', 'я', 'надо', 'нужно', 'не', 'забыть', 'обязательно', 'срочно', 'важно', 'важное', 'очень', 'критично', 'сегодня', 'завтра', 'потом', 'тоже'])
const infinitive = '^\\p{L}+(?:ать|ять|еть|ить|оть|уть|ыть|сти|зти|йти|дти|чь)(?:ся|сь)?$'
const notVerbs = new Set(['опять', 'пять', 'девять', 'десять', 'мать', 'память', 'кровать', 'печать', 'сеть', 'треть', 'благодать', 'ночь', 'дочь', 'речь', 'мощь', 'части', 'власти', 'сласти', 'страсти', 'снасти', 'гладь', 'знать'])
const imperatives = new Set([
  'купи', 'позвони', 'напиши', 'сделай', 'сдай', 'запиши', 'скинь', 'отправь', 'забери', 'напомни', 'проверь',
  'посмотри', 'найди', 'закажи', 'оплати', 'приготовь', 'убери', 'выучи', 'прочитай', 'почитай', 'подготовь',
  'сходи', 'съезди', 'возьми', 'принеси', 'закинь', 'переведи', 'допиши', 'доделай', 'повтори', 'сыграй',
  'свяжись', 'договорись', 'уточни', 'спроси', 'скачай', 'установи', 'обнови', 'помой', 'постирай',
  'погладь', 'выкинь', 'вынеси', 'отнеси', 'забронируй', 'запишись', 'не забудь',
])

/** Есть ли в строке действие: глагол в первых трёх словах (после «надо», «важно» и т. п.). */
export function isAction(line: string): boolean {
  const ws = normalize(line).split(/[^\p{L}]+/u).filter(Boolean)
  if (ws[0] === 'надо' || ws[0] === 'нужно') return true
  const lower = line.toLowerCase()
  if (lower.startsWith('не забыть') || lower.startsWith('не забудь')) return true
  let checked = 0
  for (const w of ws) {
    if (actionLead.has(w)) continue
    if (imperatives.has(w) || (w.endsWith('те') && imperatives.has(w.slice(0, -2)))) return true
    if (!notVerbs.has(w) && !w.endsWith('ости') && test(w, infinitive)) return true
    checked++
    if (checked >= 3) break
  }
  return false
}

export function analyze(raw: string, studyHints: string[] = [], now = new Date()): CaptureAnalysis {
  let text = raw.trim()
  if (!text) return { kind: 'note', tasks: [] }

  let forced: CaptureKind | null = null
  const prefixes: [string, CaptureKind][] = [
    ['заметка|мысль|идея|набросок|строчк\\p{L}*', 'note'],
    ['задача|план|дедлайн|сделать', 'task'],
  ]
  for (const [ws, kind] of prefixes) {
    const pattern = '^(?:' + ws + ')\\s*:\\s*'
    if (test(text, pattern)) {
      forced = kind
      text = replace(text, pattern, '')
      break
    }
  }
  // Одна подсказка без текста («задача:») — ещё нечего сохранять
  if (!text.trim()) return { kind: forced ?? 'note', tasks: [] }

  let tasks = tasksFrom(text, studyHints, now)
  if (!tasks.length) {
    const box = { title: text }
    const priority = extractPriority(box)
    const weak = { value: false }
    const due = extractDue(box, weak, now)
    let title = trimChars(box.title, ' ,.:;-—')
    if (!title || test(title, '^' + leftovers + '$')) title = text
    const routed = router.route(title, studyHints)
    tasks = [{ title: capitalizeFirst(title), area: routed.area, dueDate: due, priority, areaMatched: routed.source.kind !== 'fallback', dueIsWeak: weak.value, suggest: routed.suggest }]
  }
  if (forced) return { kind: forced, tasks }

  const lines = text.split('\n').filter((l) => l.trim())
  const actionLines = lines.filter(isAction).length
  const areaMatched = tasks.some((t) => t.areaMatched)
  const hasDue = tasks.some((t) => t.dueDate && (!t.dueIsWeak || actionLines > 0 || t.areaMatched))
  const important = tasks.some((t) => t.priority !== Priority.Normal)

  let kind: CaptureKind
  if (lines.length >= 2 && actionLines === 0 && !areaMatched) kind = 'note'
  else if (hasDue || important || (actionLines > 0 && actionLines * 2 >= lines.length)) kind = 'task'
  else if (lines.length >= 2) kind = 'note'
  else if (areaMatched) kind = 'task'
  else kind = 'note'
  return { kind, tasks }
}

// MARK: - Помощники

export function capitalizeFirst(s: string): string {
  const chars = [...s]
  return chars.length ? chars[0].toUpperCase() + chars.slice(1).join('') : s
}

/** Заглавная — в начале и после «. », «! », «? » и переноса; «example.com» и «15.00 созвон» не трогаем. */
function capitalizeSentences(s: string): string {
  let out = ''
  let capitalizeNext = true
  let afterPunctuation = false
  for (const ch of s) {
    if (afterPunctuation && !isSpace(ch) && !'.!?'.includes(ch)) capitalizeNext = false
    // «5км пробежать», «100 отжиманий» — после числа заглавная не нужна
    if (/\d/.test(ch)) capitalizeNext = false
    if (capitalizeNext && isLetter(ch)) {
      out += ch.toUpperCase()
      capitalizeNext = false
    } else out += ch
    if ('.!?'.includes(ch)) {
      capitalizeNext = true
      afterPunctuation = true
    } else if (ch === '\n') {
      capitalizeNext = true
      afterPunctuation = false
    } else if (!isSpace(ch)) afterPunctuation = false
  }
  return out
}
