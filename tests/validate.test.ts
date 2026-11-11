import { describe, expect, it } from 'vitest'
import { capitalizeName, roomProblem, teacherProblem } from '../src/lib/validate'

describe('проверка полей пары', () => {
  it('аудитория', () => {
    for (const ok of ['', '301', '1230а', '5-12', 'Г-301', '301/2', 'Спортзал', 'онлайн', 'Актовый зал', 'Корпус Б, 214']) expect(roomProblem(ok)).toBeNull()
    for (const bad of ['абв', 'Корпус Б', '301!', 'ауд#5']) expect(roomProblem(bad)).not.toBeNull()
  })
  it('преподаватель', () => {
    for (const ok of ['', 'Иванов Иван Иванович', 'Петрова-Водкина Анна Сергеевна', 'Иван Иванов', 'Иванов И.И.', 'Иванов И. И.', 'И.И. Иванов', 'Иванов И.', 'Иванов Иван Иванович, Петров П.П.']) expect(teacherProblem(ok), ok).toBeNull()
    for (const bad of ['Иванов', 'иванов иван иванович', 'Иван0в Иван Иванович', 'И.И.', 'Иванов И.И. П.П.']) expect(teacherProblem(bad), bad).not.toBeNull()
    expect(capitalizeName('иванов иван иванович')).toBe('Иванов Иван Иванович')
    expect(capitalizeName('иванов и.и.')).toBe('Иванов И.И.')
    expect(teacherProblem(capitalizeName('и.и. иванов'))).toBeNull()
  })
})
