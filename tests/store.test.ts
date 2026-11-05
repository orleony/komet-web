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
    store.setCell(1, slot, [{ ...e, parity: 'numerator' }, { ...e, parity: 'denominator' }])
    expect(store.classes().map((c) => [c.title, c.parity]).sort()).toEqual([['A', 'denominator'], ['A', 'numerator']])
  })
})
