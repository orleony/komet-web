// Проверка полей пары при ручном вводе: аудитория — с номером, преподаватель — фамилия с именем или инициалами.

/** Места без номера, которые всё равно понятны */
const namedPlaces = /онлайн|дистанц|zoom|зум|спортзал|актов|бассейн|стадион|манеж|библиотек|лаборатор|кафедр|деканат|(?<![\p{L}])зал(?![\p{L}])/iu

/** Что не так с аудиторией; null — всё хорошо (пустое поле тоже можно) */
export function roomProblem(room: string): string | null {
  const r = room.trim()
  if (!r || namedPlaces.test(r)) return null
  if (!/\d/.test(r)) return 'В номере аудитории нужны цифры, например 301 или 1230а'
  if (!/^[\p{L}\d\s.,\-/№()]+$/u.test(r)) return 'Только цифры, буквы и «-» или «/»: 301, 1230а, 5-12, Г-301'
  return null
}

const nameWord = /^\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?$/u
/** «И.», «И.И.», «И. И.» */
const initials = /^(?:\p{Lu}\.\s?){1,2}$/u

/** Что не так с преподавателем; несколько — через запятую.
 *  Подходит: «Иванов Иван Иванович», «Иван Иванов» (без отчества), «Иванов И.И.», «И.И. Иванов». */
export function teacherProblem(teacher: string): string | null {
  const people = teacher.split(/\s*[,;]\s*/).map((t) => t.trim()).filter(Boolean)
  if (!people.length) return null
  for (const p of people) {
    // «И. И.» с пробелом — одно целое
    const words = p.replace(/(\p{Lu}\.)\s+(?=\p{Lu}\.)/gu, '$1').split(/\s+/)
    const names = words.filter((w) => nameWord.test(w))
    const inits = words.filter((w) => initials.test(w))
    if (names.length + inits.length !== words.length) return `${p}: только буквы, каждое слово с заглавной`
    if (!names.length) return `${p}: нужна фамилия`
    if (words.length < 2) return `${p}: добавь имя или инициалы — например, ${p} Иван Иванович или ${p} И.И.`
    if (words.length > 4 || inits.length > 1) return `${p}: похоже на опечатку — Фамилия Имя Отчество или Фамилия И.О.`
  }
  return null
}

/** «иванов иван иванович» → «Иванов Иван Иванович» */
export function capitalizeName(teacher: string): string {
  // После точки тоже: «и.и.» → «И.И.»
  return teacher.replace(/(^|[\s,;.-])(\p{Ll})/gu, (_m, a, b) => a + b.toUpperCase())
}
