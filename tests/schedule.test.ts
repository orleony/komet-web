// Звонки, разбор вставленного расписания и календаря .ics
import { describe, expect, it } from 'vitest'
import { computeBells, defaultBellParams, parseICS, parseScheduleText, slotIndex } from '../src/lib/schedule'
import type { WeekParity } from '../src/model'

const bells = computeBells({ first: 8 * 60 + 40, length: 95, pause: 10, bigAfter: 0, bigPause: 0, count: 6 })
const t = (h: number, m: number) => h * 60 + m

describe('звонки', () => {
  it('считает пары с переменами и большим перерывом', () => {
    const b = computeBells(defaultBellParams)
    expect(b.slice(0, 4)).toEqual([
      { start: t(9, 0), end: t(10, 30) },
      { start: t(10, 40), end: t(12, 10) },
      { start: t(12, 50), end: t(14, 20) },
      { start: t(14, 30), end: t(16, 0) },
    ])
  })
  it('номер пары по времени, с допуском', () => {
    expect(slotIndex(bells, t(10, 25))).toBe(1)
    expect(slotIndex(bells, t(10, 30))).toBe(1)
    expect(slotIndex(bells, t(7, 0))).toBeNull()
  })
})

describe('вставка текста', () => {
  it('заголовки дней и номера пар', () => {
    const r = parseScheduleText(`Понедельник
1 пара Математический анализ (лекция) ауд. 301 Иванов И.И.
2) Физика, практика, 214, Петров П. П.

Вторник:
3. Программирование лаб. к. 5-12 Сидоров Пётр Алексеевич`, bells)
    expect(r.map((c) => [c.weekday, c.number, c.title, c.kind, c.room, c.teacher, c.startMin])).toEqual([
      [1, 1, 'Математический анализ', 'Лекция', '301', 'Иванов И.И.', t(8, 40)],
      [1, 2, 'Физика', 'Практика', '214', 'Петров П.П.', t(10, 25)],
      [2, 3, 'Программирование', 'Лабораторная работа', '5-12', 'Сидоров Пётр Алексеевич', t(12, 10)],
    ])
  })

  it('время вместо номера, день в той же строке', () => {
    const r = parseScheduleText('Ср 10:25–12:00 Сети ЭВМ лаб 254 Гизбрехт И.И.', bells)
    expect(r[0]).toMatchObject({ weekday: 3, number: 2, startMin: t(10, 25), endMin: t(12, 0), title: 'Сети ЭВМ', kind: 'Лабораторная работа', room: '254' })
  })

  it('числитель и знаменатель', () => {
    const r = parseScheduleText(`Четверг
2 Организация ЭВМ лекция 365 (числ.)
2 Организация производства лекция 365 знаменатель`, bells)
    expect(r.map((c) => [c.title, c.parity])).toEqual([['Организация ЭВМ', 'numerator'], ['Организация производства', 'denominator']])
  })

  it('как копируют с сайта вуза', () => {
    const r = parseScheduleText(`ЧЕТВЕРГ
08:40-10:15 Сети ЭВМ и телекоммуникации (Лабораторная работа) 254 Гизбрехт Иван Иванович
10:25-12:00 Организация ЭВМ и систем | Лекция | ауд. 365 | Ефремов Николай Владимирович | числитель`, bells)
    expect(r.map((c) => [c.weekday, c.number, c.title, c.kind, c.room, c.teacher, c.parity])).toEqual([
      [4, 1, 'Сети ЭВМ и телекоммуникации', 'Лабораторная работа', '254', 'Гизбрехт Иван Иванович', 'every'],
      [4, 2, 'Организация ЭВМ и систем', 'Лекция', '365', 'Ефремов Николай Владимирович', 'numerator'],
    ])
  })

  it('мусор без дня и пустые строки — пропускает', () => {
    expect(parseScheduleText('Расписание группы ИВТ-21\n\n1 пара что-то', bells)).toEqual([])
  })
})

describe('календарь .ics', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Moscow:20261102T084000',
    'DTEND;TZID=Europe/Moscow:20261102T101500',
    'SUMMARY:Лекция: Математический анализ',
    'LOCATION:301',
    'DESCRIPTION:Иванов Иван Иванович',
    'RRULE:FREQ=WEEKLY;UNTIL=20261230T000000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261103T072500Z',
    'DTEND:20261103T090000Z',
    'SUMMARY:Физика (пр.)',
    'LOCATION:214',
    'RRULE:FREQ=WEEKLY;INTERVAL=2',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const parityOf = (d: Date): WeekParity => (Math.floor(d.getTime() / (7 * 86_400_000)) % 2 === 0 ? 'numerator' : 'denominator')

  it('еженедельное — каждую неделю, раз в две — по чётности', () => {
    const r = parseICS(ics, parityOf, bells)
    expect(r[0]).toMatchObject({ weekday: 1, startMin: t(8, 40), endMin: t(10, 15), title: 'Математический анализ', kind: 'Лекция', room: '301', teacher: 'Иванов Иван Иванович', parity: 'every', number: 1 })
    expect(r[1]).toMatchObject({ weekday: 2, title: 'Физика', kind: 'Практика', room: '214' })
    expect(r[1].parity).not.toBe('every')
  })
})

describe('находки тестировщика: текст', () => {
  const p = (s: string) => parseScheduleText(s, bells).map((c) => ({ day: c.weekday, n: c.number, title: c.title, kind: c.kind, room: c.room, teacher: c.teacher, parity: c.parity, start: c.startMin }))
  it('римские номера', () => expect(p('Понедельник\nI пара Матан\nII пара Физика')).toMatchObject([{ n: 1, title: 'Матан' }, { n: 2, title: 'Физика' }]))
  it('«(нечётная неделя)» и «чётная неделя»', () =>
    expect(p('Вторник\nФизика (нечётная неделя) 214\nХимия чётная неделя 215')).toMatchObject([
      { title: 'Физика', parity: 'numerator', room: '214' }, { title: 'Химия', parity: 'denominator', room: '215' }]))
  it('подгруппа и аудитория через дробь', () =>
    expect(p('Среда\nАнглийский язык (1 подгруппа) ауд. 301/2')).toMatchObject([{ title: 'Английский язык', kind: '1 подгр.', room: '301/2' }]))
  it('два преподавателя', () =>
    expect(p('Четверг\n2 пара Физика лекция Иванов И.И., Петров П.П.')).toMatchObject([{ title: 'Физика', teacher: 'Иванов И.И., Петров П.П.' }]))
  it('«Практическая психология» — предмет, не вид', () =>
    expect(p('Пятница\n3 Практическая психология')).toMatchObject([{ title: 'Практическая психология', kind: '' }]))
  it('«Программирование лаба»', () => expect(p('Пт\n1 Программирование лаба')).toMatchObject([{ title: 'Программирование', kind: 'Лабораторная работа' }]))
  it('дата перед днём недели', () => expect(p('09.11.2026 Понедельник\n1 пара Матан')).toMatchObject([{ day: 1, title: 'Матан' }]))
  it('одно поле на строку', () =>
    expect(p('Понедельник\n1 пара\n08:40-10:15\nМатематика\nлекция\nауд. 301\nИванов И.И.\n2 пара\nФизика')).toMatchObject([
      { n: 1, start: t(8, 40), title: 'Математика', kind: 'Лекция', room: '301', teacher: 'Иванов И.И.' },
      { n: 2, title: 'Физика' }]))
  it('время с пробелами и эмодзи', () => expect(p('📚 Пн\n📚 1 пара Матан\n08 : 40 - 10 : 15 Физика')).toMatchObject([{ n: 1, title: 'Матан' }, { start: t(8, 40), title: 'Физика' }]))
  it('год — не аудитория, корпус не в названии', () =>
    expect(p('Сб\n1 Подготовка к ЕГЭ 2026\n2 Физика корп. 2 ауд. 301')).toMatchObject([{ title: 'Подготовка к ЕГЭ 2026', room: '' }, { title: 'Физика', room: '301' }]))
})

describe('находки тестировщика: .ics', () => {
  const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
  const cal = (...events: string[][]) => ['BEGIN:VCALENDAR', ...events.flat(), 'END:VCALENDAR'].join('\r\n')
  const every = (): WeekParity => 'numerator'
  it('каникулы на весь день и отменённые — мимо', () => {
    expect(parseICS(cal(ev('DTSTART;VALUE=DATE:20261109', 'DTEND;VALUE=DATE:20261116', 'SUMMARY:Каникулы', 'RRULE:FREQ=WEEKLY'),
      ev('DTSTART:20261110T090000', 'DTEND:20261110T103000', 'SUMMARY:Отменено', 'STATUS:CANCELLED', 'RRULE:FREQ=WEEKLY')), every, bells)).toEqual([])
  })
  it('разовое событие — не пара', () => expect(parseICS(cal(ev('DTSTART:20261110T090000', 'DTEND:20261110T103000', 'SUMMARY:Собрание')), every, bells)).toEqual([]))
  it('DURATION вместо DTEND, BYDAY на два дня, напоминание внутри', () => {
    const r = parseICS(cal(ev('DTSTART:20261109T084000', 'DURATION:PT1H35M', 'SUMMARY:Матан', 'DESCRIPTION:Группа ИВТ-21\\, лекция\\, Иванов Иван Иванович',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'BEGIN:VALARM', 'DESCRIPTION:Напоминание', 'END:VALARM')), every, bells)
    expect(r.map((c) => [c.weekday, c.startMin, c.endMin, c.title, c.kind, c.teacher])).toEqual([
      [1, t(8, 40), t(10, 15), 'Матан', 'Лекция', 'Иванов Иван Иванович'],
      [3, t(8, 40), t(10, 15), 'Матан', 'Лекция', 'Иванов Иван Иванович']])
  })
  it('пробелы в конце строк', () => {
    expect(parseICS(['BEGIN:VCALENDAR ', 'BEGIN:VEVENT ', 'DTSTART:20261109T084000 ', 'DTEND:20261109T101500 ', 'SUMMARY:Матан ', 'RRULE:FREQ=WEEKLY ', 'END:VEVENT ', 'END:VCALENDAR'].join('\r\n'), every, bells)).toHaveLength(1)
  })
})
