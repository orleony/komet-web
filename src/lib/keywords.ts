// Ключевые слова разделов — как на Mac: совпало — запись уходит в раздел, иначе — в раздел по умолчанию.

export const defaultStudy =
  'доделать, переделать, сдать, пересдать, решить, подготовить, выучить, повторить, ' +
  'прочитать, лаба, лабораторная, пара, экзамен, зачёт, домашка, дз, курсовая, реферат, семинар, лекция, ' +
  'контрольная, сессия, доклад, конспект, диплом, учёба, универ, препод'

export const defaultMusic =
  'свести, перезаписать, сыграть, спеть, сочинить, отмастерить, трек, демо, демка, куплет, ' +
  'припев, бит, текст, клип, видео, сведение, мастеринг, вокал, релиз, аранжировка, мелодия, хук, песня, ' +
  'альбом, сингл, студия, микс, сэмпл, рифма, репетиция, концерт, гитара, синтезатор'

/** Прежние стандартные наборы: если пользователь их не менял, обновляем до новых (как на Mac). */
export const previousStudy =
  'доделать, переделать, сдать, пересдать, решить, подготовить, выучить, повторить, ' +
  'прочитать, лаба, лабораторная, пара, экзамен, зачёт, домашка, дз, курсовая, реферат, семинар, лекция, ' +
  'контрольная, сессия, доклад, конспект, диплом, билеты, учёба, универ, препод'
export const previousMusic =
  'свести, перезаписать, сыграть, спеть, сочинить, отмастерить, трек, демо, демка, куплет, ' +
  'припев, бит, текст, клип, видео, сведение, мастеринг, вокал, релиз, аранжировка, мелодия, хук, песня, ' +
  'альбом, сингл, студия, микс, сэмпл, рифма'

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е')
}

export function parse(raw: string): string[] {
  return raw
    .split(/[,\n;]/)
    .map((s) => normalize(s).trim())
    .filter(Boolean)
}

/** Слова из букв */
export function words(text: string): string[] {
  return normalize(text).split(/[^\p{L}]+/u).filter(Boolean)
}

/** «Пару дней», «пару часов» — это не учебная пара. */
const timeUnits = new Set(['дней', 'дня', 'часов', 'часа', 'минут', 'минуты', 'недель', 'недели', 'раз', 'месяцев', 'лет', 'штук', 'слов', 'секунд'])

const pairBefore = new Set(['на', 'пропустить', 'пропустил', 'пропустила', 'прогулять', 'прогулял', 'прогуляла', 'отработать', 'перенести', 'перенесли', 'отменили', 'отменить', 'первую', 'вторую', 'третью', 'четвертую', 'последнюю', 'эту', 'следующую'])

const nounEndings = new Set('аеиоуыэюяйьмхв')

const shortEndings = new Set(['', 'а', 'я', 'у', 'ю', 'ы', 'и', 'е', 'о', 'ь', 'ой', 'ей', 'ою', 'ом', 'ем', 'ам', 'ям', 'ами', 'ями', 'ах', 'ях', 'ов', 'ев'])

const isVerb = (w: string) => ['ть', 'ти', 'чь'].some((e) => w.endsWith(e))

/** «лаба» ловит «лабу», «трек» — «треков», но «пара» не ловит «парк», а «записать» — «записаться». */
export function matches(word: string, keyword: string): boolean {
  if (word === keyword) return true
  if (isVerb(keyword)) {
    const stem = keyword.slice(0, -2)
    if ([...stem].length < 4 || !word.startsWith(stem)) return false
    return [...word].length - [...stem].length <= 3
  }
  const minStem = [...keyword].length <= 4 ? 3 : 4
  let stem = [...keyword]
  while (stem.length > minStem && nounEndings.has(stem[stem.length - 1])) stem.pop()
  const s = stem.join('')
  if (!word.startsWith(s)) return false
  const rest = word.slice(s.length)
  // У коротких основ — только настоящие окончания: «бит» ≠ «битва», «зал» ≠ «залив»
  if (stem.length <= 3) return shortEndings.has(rest)
  return [...rest].length <= 3 && [...rest].every((c) => nounEndings.has(c))
}

/** Сколько очков текст набирает для раздела. Существительные и фразы — 2, глаголы — 1. */
export function score(text: string, keywords: string[]): number {
  const ws = words(text)
  let total = 0
  for (const keyword of keywords) {
    const parts = keyword.split(' ').filter(Boolean)
    if (parts.length > 1) {
      const found = ws.some((_, start) => start + parts.length <= ws.length && parts.every((p, i) => matches(ws[start + i], p)))
      if (found) total += 2
      continue
    }
    const found = ws.some((w, i) => {
      if (!matches(w, keyword)) return false
      if (keyword === 'пара' && i + 1 < ws.length && timeUnits.has(ws[i + 1])) return false
      // «Купить пару носков» — не учебная пара; «пропустить пару», «на пару», «пару по матану» — учебная
      if (keyword === 'пара' && ws[i] === 'пару' && !(i > 0 && pairBefore.has(ws[i - 1])) && ws[i + 1] !== 'по' && i + 1 < ws.length) return false
      return true
    })
    if (found) total += isVerb(keyword) ? 1 : 2
  }
  return total
}
