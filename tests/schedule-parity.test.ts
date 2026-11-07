// Разбор расписания на Mac должен совпадать с веб-версией: ответы Swift сняты в schedule-swift.json (scripts/schedule-parity.sh)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseICS, parseScheduleText } from '../src/lib/schedule'

const cases = JSON.parse(readFileSync(new URL('./schedule-cases.json', import.meta.url), 'utf8'))
const swift = JSON.parse(readFileSync(new URL('./schedule-swift.json', import.meta.url), 'utf8'))
const now = new Date(cases.now * 1000)

describe('расписание как на Mac', () => {
  cases.texts.forEach((text: string, i: number) => {
    it(text.split('\n').slice(0, 2).join(' / '), () => expect(parseScheduleText(text, cases.bells)).toEqual(swift.texts[i]))
  })
  cases.ics.forEach((text: string, i: number) => {
    it('ics ' + i, () => expect(parseICS(text, () => 'numerator', cases.bells, now)).toEqual(swift.ics[i]))
  })
})
