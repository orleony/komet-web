// Разбор фраз должен совпадать с Mac-версией: ответы Swift сняты в swift-parity.json
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { analyze, clean } from '../src/lib/text'
import { router } from '../src/lib/router'
import { defaultMusic, defaultStudy } from '../src/lib/keywords'

const expected = JSON.parse(readFileSync(new URL('./swift-parity.json', import.meta.url), 'utf8'))
// Сроки — в днях от сегодня (и день недели): эталон не устаревает со сменой даты
import { daysLeft, isoWeekday } from '../src/lib/dates'

router.areas = [
  { id: 'study', title: 'Учёба', icon: '', colorIndex: 0, keywords: defaultStudy, sortOrder: 0, createdAt: 0, updatedAt: 0 },
  { id: 'music', title: 'Музыка', icon: '', colorIndex: 1, keywords: defaultMusic, sortOrder: 1, createdAt: 0, updatedAt: 0 },
  { id: 'personal', title: 'Личное', icon: '', colorIndex: 2, keywords: '', sortOrder: 2, createdAt: 0, updatedAt: 0 },
]
router.mlEnabled = false

describe('как на Mac', () => {
  for (const e of expected) {
    it(e.phrase.replace(/\n/g, ' / '), () => {
      const a = analyze(e.phrase)
      expect(clean(e.phrase)).toBe(e.clean)
      expect(a.kind).toBe(e.kind)
      expect(a.tasks.map((t) => ({ title: t.title, area: t.area.id, due: t.dueDate ? daysLeft(t.dueDate) : -999, weekday: t.dueDate ? isoWeekday(t.dueDate) : 0, priority: t.priority, weak: t.dueIsWeak })))
        .toEqual(e.tasks)
    })
  }
})
