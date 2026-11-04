import type { Area, TaskItem } from '../model'
import { normalize, parse, score } from './keywords'
import { templateByID, templates } from './templates'
import type { AreaTemplate } from './templates'

// Куда положить запись: 1) ключевые слова раздела (и предметы/преподы из расписания — для «Учёбы»),
// 2) наивный Байес, обученный на твоих же задачах, 3) раздел по умолчанию.

export type RouteSource = { kind: 'keyword' } | { kind: 'model'; confidence: number } | { kind: 'fallback' }

export interface Route {
  area: Area
  source: RouteSource
  /** Похоже на популярный раздел, которого у тебя ещё нет, — можно создать */
  suggest?: AreaTemplate
}

/** Из какого готового раздела этот раздел (с Mac приходят study/music/personal без пометки). */
export const templateOf = (a: Area) => templateByID(a.template ?? a.id)

/** Грубое приведение к основе: «тренировку» и «тренировка» → «тренировк». */
export function stem(text: string): string {
  const endings = new Set('аеиоуыэюяйь')
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => {
      let s = [...w]
      if (s.length > 6) s = s.slice(0, -2)
      while (s.length > 3 && endings.has(s[s.length - 1])) s.pop()
      return s.join('')
    })
    .join(' ')
}

class NaiveBayes {
  private prior = new Map<string, number>()
  private counts = new Map<string, Map<string, number>>()
  private totals = new Map<string, number>()
  private vocabulary = new Set<string>()

  constructor(texts: string[], labels: string[]) {
    texts.forEach((text, i) => {
      const label = labels[i]
      this.prior.set(label, (this.prior.get(label) ?? 0) + 1)
      for (const w of text.split(' ').filter(Boolean)) {
        const c = this.counts.get(label) ?? new Map<string, number>()
        c.set(w, (c.get(w) ?? 0) + 1)
        this.counts.set(label, c)
        this.totals.set(label, (this.totals.get(label) ?? 0) + 1)
        this.vocabulary.add(w)
      }
    })
    for (const [k, v] of this.prior) this.prior.set(k, v / labels.length)
  }

  probabilities(text: string): Map<string, number> {
    const ws = text.split(' ').filter((w) => this.vocabulary.has(w))
    const out = new Map<string, number>()
    if (!ws.length) return out
    const v = this.vocabulary.size
    const logs = new Map<string, number>()
    for (const [label, p] of this.prior) {
      const c = this.counts.get(label) ?? new Map()
      const total = this.totals.get(label) ?? 0
      logs.set(label, Math.log(p) + ws.reduce((acc, w) => acc + Math.log(((c.get(w) ?? 0) + 1) / (total + v)), 0))
    }
    const top = Math.max(...logs.values())
    let sum = 0
    for (const [k, l] of logs) {
      const e = Math.exp(l - top)
      out.set(k, e)
      sum += e
    }
    for (const [k, e] of out) out.set(k, e / sum)
    return out
  }
}

const minConfidence = 0.35
const minMargin = 0.08

export class AreaRouter {
  areas: Area[] = []
  fallbackID = 'personal'
  mlEnabled = true
  trainedExamples = 0
  private model: NaiveBayes | null = null
  private signature = ''

  /** Куда уходит то, что не узнали: выбранный раздел или «Входящие». */
  get fallback(): Area {
    return this.areas.find((a) => a.id === this.fallbackID) ?? placeholderArea
  }

  area(id: string): Area {
    return this.areas.find((a) => a.id === id) ?? this.fallback
  }

  route(text: string, hints: string[] = []): Route {
    const ws = normalize(text).split(/[^\p{L}]+/u).filter(Boolean)
    const hinted = ws.filter((w) => hints.some((h) => w.startsWith(h))).length
    let best: { area: Area; score: number } | null = null
    for (const area of this.areas) {
      const s = score(text, parse(area.keywords)) + (area.id === 'study' ? hinted * 2 : 0)
      if (s > (best?.score ?? 0)) best = { area, score: s }
    }
    if (best) return { area: best.area, source: { kind: 'keyword' } }

    // Слова популярного раздела, которого нет, — подскажем создать
    const missing = this.missingTemplates()
    let suggest: AreaTemplate | undefined
    let suggestScore = 0
    for (const t of missing) {
      const s = score(text, parse(t.keywords))
      if (s > suggestScore) {
        suggest = t
        suggestScore = s
      }
    }

    if (this.mlEnabled && this.model) {
      const top = [...this.model.probabilities(stem(text))].sort((a, b) => b[1] - a[1])
      const first = top[0]
      if (first && first[1] >= minConfidence && first[1] - (top[1]?.[1] ?? 0) >= minMargin) {
        const area = this.areas.find((a) => a.id === first[0])
        if (area) return { area, source: { kind: 'model', confidence: first[1] } }
        if (!suggest && first[0].startsWith('tpl:')) suggest = templateByID(first[0].slice(4)) ?? undefined
      }
    }
    return { area: this.fallback, source: { kind: 'fallback' }, suggest }
  }

  /** Популярные разделы, которых у пользователя нет. */
  missingTemplates(): AreaTemplate[] {
    const have = new Set(this.areas.map((a) => templateOf(a)?.id).filter(Boolean))
    return templates.filter((t) => !have.has(t.id))
  }

  /** Переобучает модель, если задачи или разделы поменялись.
   *  Учится на трёх источниках: ключевые слова разделов, встроенные примеры популярных разделов и твои задачи.
   *  Популярные разделы, которых у тебя нет, тоже участвуют — как «не то»: тогда «сходить в зал»
   *  не улетит в Учёбу только потому, что других разделов нет, а Komet предложит создать «Спорт». */
  retrain(tasks: TaskItem[]) {
    const signature = JSON.stringify([this.fallbackID, this.areas.map((a) => [a.id, a.keywords]), tasks.map((t) => [t.title, t.areaID])])
    if (signature === this.signature) return
    this.signature = signature

    const ids = new Set(this.areas.map((a) => a.id))
    const texts: string[] = []
    const labels: string[] = []
    const add = (text: string, label: string) => {
      const s = stem(text)
      if (!s) return
      texts.push(s)
      labels.push(label)
    }
    for (const area of this.areas) {
      for (const k of parse(area.keywords)) add(k, area.id)
      for (const e of templateOf(area)?.examples ?? []) add(e, area.id)
    }
    for (const t of this.missingTemplates()) {
      for (const k of parse(t.keywords)) add(k, 'tpl:' + t.id)
      for (const e of t.examples) add(e, 'tpl:' + t.id)
    }
    for (const t of tasks) if (ids.has(t.areaID)) add(t.title, t.areaID)
    const perLabel = new Map<string, number>()
    for (const l of labels) perLabel.set(l, (perLabel.get(l) ?? 0) + 1)
    if ([...perLabel.values()].filter((n) => n >= 2).length < 2) {
      this.model = null
      this.trainedExamples = 0
      return
    }
    this.model = new NaiveBayes(texts, labels)
    this.trainedExamples = texts.length
  }
}

export const placeholderArea: Area = {
  id: 'none', title: 'Входящие', icon: 'tray', colorIndex: 8, keywords: '', sortOrder: 0, createdAt: 0, updatedAt: 0,
}

export const router = new AreaRouter()
