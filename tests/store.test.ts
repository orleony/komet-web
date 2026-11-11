// Хранилище: звонки и клетки сетки — сценарии, найденные тестировщиком
import { beforeEach, describe, expect, it } from 'vitest'
import * as store from '../src/store'
import type { ClassSlot } from '../src/model'

const t = (h: number, m: number) => h * 60 + m
const cls = (id: string, start: number): ClassSlot => ({ id, weekday: 1, startMin: start, endMin: start + 90, title: id, teacher: '', room: '', kind: '', parity: 'every', createdAt: 1, updatedAt: 1 })
const starts = () => Object.fromEntries(store.classes().map((c) => [c.id, c.startMin]))

beforeEach(() => {
  store.data.value = { tasks: [], notes: [], classes: [], areas: [], settings: [] }
})

describe('звонки', () => {
  it('пара на несколько минут от звонка переезжает вместе с ним', () => {
    store.data.value = { ...store.data.value, classes: [cls('A', t(9, 5))] }
    store.setBells([{ start: t(9, 0), end: t(10, 30) }, { start: t(10, 40), end: t(12, 10) }])
    store.setBells([{ start: t(8, 30), end: t(10, 0) }, { start: t(10, 10), end: t(11, 40) }])
    expect(starts()).toEqual({ A: t(8, 30) })
  })
  it('время первой пары поставили позже второй — пары не меняются местами', () => {
    store.data.value = { ...store.data.value, classes: [cls('A', t(9, 0)), cls('B', t(10, 40))] }
    store.setBells([{ start: t(9, 0), end: t(10, 30) }, { start: t(10, 40), end: t(12, 10) }])
    store.setBells([{ start: t(12, 20), end: t(13, 50) }, { start: t(10, 40), end: t(12, 10) }])
    expect(starts()).toEqual({ A: t(12, 20), B: t(10, 40) })
    expect(store.bells().map((b) => b.start)).toEqual([t(10, 40), t(12, 20)])
  })
})

describe('клетка сетки', () => {
  it('каждую неделя → числитель/знаменатель с одинаковыми полями — пара на обеих неделях', () => {
    store.data.value = { ...store.data.value, classes: [cls('A', t(9, 0))] }
    const slot = { start: t(9, 0), end: t(10, 30) }
    const e = { title: 'A', teacher: '', room: '', kind: '' }
    store.setCell(1, slot, [{ ...e, id: 'A', parity: 'numerator' }, { ...e, parity: 'denominator' }], ['A'])
    expect(store.classes().map((c) => [c.title, c.parity]).sort()).toEqual([['A', 'denominator'], ['A', 'numerator']])
  })
})

describe('две подгруппы в одной клетке', () => {
  it('правка одной пары не удаляет вторую', () => {
    store.data.value = { ...store.data.value, classes: [cls('A', t(8, 30)), { ...cls('B', t(8, 30)), title: 'Немецкий' }] }
    const slot = { start: t(8, 30), end: t(10, 0) }
    store.setCell(1, slot, [{ id: 'A', parity: 'every', title: 'Английский', teacher: '', room: '', kind: '' }], ['A'])
    expect(store.classes().map((c) => c.title).sort()).toEqual(['Английский', 'Немецкий'])
  })
  it('повторная вставка того же расписания не дублирует пары', () => {
    store.data.value = { ...store.data.value, classes: [] }
    const p = { weekday: 1, number: 1, startMin: t(8, 30), endMin: t(10, 0), title: 'Матан', teacher: '', room: '', kind: '', parity: 'every' as const }
    expect(store.addParsedClasses([p], false)).toBe(1)
    expect(store.addParsedClasses([p, { ...p, kind: '2 подгр.' }], false)).toBe(1)
    expect(store.classes().length).toBe(2)
  })
})

describe('импорт файла', () => {
  it('кривые записи не ломают приложение, а пустой updatedAt не мешает обновить запись', () => {
    store.data.value = { tasks: [], notes: [], classes: [], areas: [], settings: [] }
    store.importSnapshot({ areas: [{ id: 'X' }], tasks: [{ id: 'T', areaID: 'X' }, null, 5, { title: 'нет id' }] })
    expect(store.data.value.tasks.map((x) => [x.id, x.title, x.updatedAt])).toEqual([['T', '', 0]])
    expect(store.data.value.areas[0].keywords).toBe('')
    store.importSnapshot({ tasks: [{ id: 'T', areaID: 'X', title: 'Новое', updatedAt: 999 }] })
    expect(store.data.value.tasks[0].title).toBe('Новое')
    expect(() => store.importSnapshot({ hello: 1 })).toThrow()
    expect(() => store.importSnapshot(null)).toThrow()
  })
})

describe('свои звонки дня (ВУЦ по вторникам)', () => {
  const day = (id: string, weekday: number, start: number): ClassSlot => ({ ...cls(id, start), weekday })
  it('общие звонки подбираются без особого дня, а он попадает в подсказку', () => {
    store.data.value = { ...store.data.value, classes: [day('M1', 1, t(8, 40)), day('M2', 1, t(10, 25)), day('W1', 3, t(8, 40)), day('W2', 3, t(10, 25)), day('V1', 2, t(10, 0)), day('V2', 2, t(11, 40))] }
    expect(store.bells().map((b) => b.start)).toEqual([t(8, 40), t(10, 25)])
    expect(store.offBellDays()).toEqual([2])
    store.fitDayBells(2)
    expect(store.dayBells(2)?.map((b) => b.start)).toEqual([t(10, 0), t(11, 40)])
    expect(store.offBellDays()).toEqual([])
  })
  it('смена общих звонков не двигает особый день, а звонки дня двигают только его', () => {
    store.data.value = { ...store.data.value, classes: [day('M1', 1, t(9, 0)), day('V1', 2, t(10, 0))] }
    store.setBells([{ start: t(9, 0), end: t(10, 30) }])
    store.setBells([{ start: t(10, 0), end: t(11, 30) }], 2)
    store.setBells([{ start: t(8, 30), end: t(10, 0) }])
    expect(starts()).toEqual({ M1: t(8, 30), V1: t(10, 0) })
    store.setBells([{ start: t(10, 15), end: t(11, 45) }], 2)
    expect(starts()).toEqual({ M1: t(8, 30), V1: t(10, 15) })
    expect(store.bellsFor(2)[0].start).toBe(t(10, 15))
    expect(store.bellsFor(1)[0].start).toBe(t(8, 30))
  })
})

describe('преподаватели запоминаются', () => {
  it('список без повторов и кто ведёт предмет', () => {
    store.data.value = { ...store.data.value, classes: [{ ...cls('A', t(9, 0)), title: 'Матан', teacher: 'Иванов И.И., Петров П.П.' }, { ...cls('B', t(11, 0)), title: 'Физика', teacher: 'Иванов И.И.' }] }
    expect(store.knownTeachers().sort()).toEqual(['Иванов И.И.', 'Петров П.П.'])
    expect(store.teacherOf('матан')).toBe('Иванов И.И., Петров П.П.')
    expect(store.teacherOf('История')).toBeNull()
  })
})

describe('клетка с «каждую неделю» и знаменателем', () => {
  it('сохранение в режиме числ./знам. не удаляет пару «каждую неделю»', () => {
    store.data.value = { ...store.data.value, classes: [cls('E', t(9, 0)), { ...cls('D', t(9, 0)), title: 'Физика', parity: 'denominator' }] }
    const slot = { start: t(9, 0), end: t(10, 30) }
    store.setCell(1, slot, [{ id: 'D', parity: 'denominator', title: 'Физика', teacher: 'Петров П.П.', room: '', kind: '' }], ['D'])
    expect(store.classes().map((c) => c.id).sort()).toEqual(['D', 'E'])
  })
})

describe('оформление заметки после Mac', () => {
  it('та же заметка с Mac без html не затирает оформление', () => {
    const note = { id: 'N', text: 'Привет', html: '<b>Привет</b>', kind: 'note' as const, isPinned: false, createdAt: 1, updatedAt: 5, trashedAt: null, rich: null }
    store.data.value = { tasks: [], notes: [note], classes: [], areas: [], settings: [] }
    const fromMac = { ...note } as any
    delete fromMac.html
    expect(store.importSnapshot({ notes: [fromMac] })).toBe(0)
    expect(store.data.value.notes[0].html).toBe('<b>Привет</b>')
  })
})
