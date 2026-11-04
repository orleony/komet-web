// Встроенные знания разделов: фразы, которых нет в примерах, должны попадать куда надо
import { describe, expect, it } from 'vitest'
import { AreaRouter } from '../src/lib/router'
import { templates } from '../src/lib/templates'
import type { Area } from '../src/model'

const fromTemplate = (id: string): Area => {
  const t = templates.find((x) => x.id === id)!
  return { id: 'u-' + id, title: t.title, icon: t.icon, colorIndex: t.colorIndex, keywords: t.keywords, sortOrder: 0, createdAt: 0, updatedAt: 0, template: id }
}

function router(areaIDs: string[]) {
  const r = new AreaRouter()
  r.areas = areaIDs.map(fromTemplate)
  r.fallbackID = 'none'
  r.retrain([])
  return r
}

// Ни одной из этих фраз нет во встроенных примерах дословно
const cases: [string, string][] = [
  ['подготовиться к экзамену по физике', 'study'],
  ['доделать лабораторную по химии', 'study'],
  ['написать реферат по истории', 'study'],
  ['свести новый трек', 'music'],
  ['записать вокал на припев', 'music'],
  ['сходить на тренировку вечером', 'sport'],
  ['пробежка в парке', 'sport'],
  ['сходить в бассейн', 'sport'],
  ['созвон с заказчиком в 11', 'work'],
  ['отправить отчёт по проекту', 'work'],
  ['помыть посуду и вынести мусор', 'home'],
  ['записаться к врачу', 'health'],
  ['купить витамины в аптеке', 'health'],
  ['оплатить интернет за месяц', 'finance'],
  ['забронировать отель в казани', 'travel'],
  ['смонтировать видео для ютуба', 'creative'],
  ['поиграть в доту с друзьями', 'games'],
  ['дочитать книгу до конца', 'reading'],
]

describe('без разделов — подсказывает, какой создать', () => {
  const r = router([])
  for (const [phrase, expected] of cases) {
    it(phrase, () => {
      const route = r.route(phrase)
      expect(route.area.id).toBe('none')
      expect(route.suggest?.id).toBe(expected)
    })
  }
})

describe('с разделами — кладёт в нужный', () => {
  const all = ['study', 'music', 'sport', 'work', 'home', 'health', 'finance', 'travel', 'creative', 'games', 'reading', 'personal']
  const r = router(all)
  for (const [phrase, expected] of cases) {
    it(phrase, () => expect(r.route(phrase).area.id).toBe('u-' + expected))
  }
})

describe('только Учёба и Спорт — чужое не тянет к себе', () => {
  const r = router(['study', 'sport'])
  it('спорт → Спорт', () => expect(r.route('сходить в зал на тренировку').area.id).toBe('u-sport'))
  it('учёба → Учёба', () => expect(r.route('сдать курсовую').area.id).toBe('u-study'))
  it('музыка → во Входящие и подсказка', () => {
    const route = r.route('свести трек')
    expect(route.area.id).toBe('none')
    expect(route.suggest?.id).toBe('music')
  })
  it('быт → во Входящие', () => expect(r.route('помыть окна').area.id).toBe('none'))
})
