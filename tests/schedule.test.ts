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
