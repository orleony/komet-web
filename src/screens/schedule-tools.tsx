// Ввод расписания: мастер звонков, сетка недели, вставка текста и календаря.
import { Fragment } from 'preact'
import { useMemo, useRef, useState } from 'preact/hooks'
import { CalendarPlus, ClipboardPaste, Copy, GraduationCap, Plus, X } from 'lucide-preact'
import type { ClassSlot, WeekParity } from '../model'
import { plural, time, weekdayNames, weekdayShort } from '../lib/dates'
import { capitalizeName, roomProblem, teacherProblem } from '../lib/validate'
import { computeBells, defaultBellParams, parseICS, parseScheduleText, slotIndex } from '../lib/schedule'
import type { BellParams, BellSlot, ParsedClass } from '../lib/schedule'
import * as store from '../store'
import type { CellEntry } from '../store'
import { Segments, Sheet, palette, showToast, tint, useSheet } from '../ui/controls'

const classColor = palette[0]

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromTime = (v: string) => {
  const [h, m] = v.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function TimeInput({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  return (
    <div class="field" style={{ minHeight: 36, padding: '0 10px' }}>
      <input type="time" value={toTime(value)} style={{ padding: '6px 0' }} onInput={(e) => { const m = fromTime(e.currentTarget.value); if (m != null) onChange(m) }} />
    </div>
  )
}

// MARK: - Первый раз

/** Карточка, пока расписания нет: три способа его завести — или «не учусь». */
export function ScheduleSetup({ onBells, onPaste, onCalendar }: { onBells: () => void; onPaste: () => void; onCalendar: () => void }) {
  if (store.classes().length || store.hasBells() || store.prefs.value.scheduleSetupDismissed) return null
  return (
    <div class="card section">
      <div class="row">
        <GraduationCap size={20} color="var(--class)" />
        <div class="grow">
          <div class="toggle-title">Настроим расписание</div>
          <div class="hint" style={{ fontSize: 12.5 }}>Пары появятся на «Сегодня», а перед каждой придёт напоминание</div>
        </div>
      </div>
      <button class="link-row" style={{ background: 'var(--raised)' }} onClick={onBells}>
        <b class="grow">Заполнить вручную</b><span class="hint">звонки → сетка</span>
      </button>
      <button class="link-row" style={{ background: 'var(--raised)' }} onClick={onPaste}>
        <b class="grow">Вставить текстом или с фото</b><span class="hint">из чата, с сайта</span>
      </button>
      <button class="link-row" style={{ background: 'var(--raised)' }} onClick={onCalendar}>
        <b class="grow">Загрузить календарь</b><span class="hint">файл .ics</span>
      </button>
      <button class="btn-text" style={{ color: 'var(--secondary)', alignSelf: 'flex-start' }}
        onClick={() => { store.setPref('scheduleSetupDismissed', true); store.setPref('showSchedule', false); showToast('Вкладку «Пары» можно вернуть в Настройках') }}>
        Я не учусь — спрятать «Пары»
      </button>
    </div>
  )
}

// MARK: - Мастер звонков

/** Параметры анкеты по уже заданным звонкам — чтобы мастер открывался с ними, а не с 9:00/90/10. */
function paramsFrom(slots: BellSlot[]): BellParams {
  const s = [...slots].sort((a, b) => a.start - b.start)
  const gaps = s.slice(1).map((x, i) => x.start - s[i].end)
  const pause = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : defaultBellParams.pause
  const big = gaps.reduce((best, g, i) => (g > pause + 5 && g > (gaps[best - 1] ?? 0) ? i + 1 : best), 0)
  return { first: s[0].start, length: s[0].end - s[0].start, pause, bigAfter: big, bigPause: big ? gaps[big - 1] : defaultBellParams.bigPause, count: s.length }
}

/** Звонки одной анкетой: Komet сам строит сетку, любое время можно поправить. */
export function BellsWizard({ onClose, onDone, day }: { onClose: () => void; onDone?: () => void; day?: number }) {
  const sheet = useSheet(onClose)
  /** 0 — для всех дней, 1…7 — особые звонки одного дня (например, ВУЦ по вторникам) */
  const [scope, setScope] = useState<number>(day ?? 0)
  const load = (d: number) => {
    const list = d ? store.dayBells(d) ?? store.bells() : store.bells()
    return list.length ? list : computeBells(defaultBellParams)
  }
  const [step, setStep] = useState<'bells' | 'parity'>('bells')
  const [p, setP] = useState<BellParams>(paramsFrom(load(scope)))
  const [slots, setSlots] = useState<BellSlot[]>(load(scope))
  const switchScope = (d: number) => {
    setScope(d)
    const list = load(d)
    setSlots(list)
    setP(paramsFrom(list))
  }
  const update = (next: Partial<BellParams>) => {
    const params = { ...p, ...next }
    setP(params)
    setSlots(computeBells(params))
  }
  const editSlot = (i: number, k: keyof BellSlot, m: number) => setSlots(slots.map((s, j) => (j === i ? { ...s, [k]: m } : s)))

  if (step === 'parity') {
    return (
      <Sheet closing={sheet.closing} title="Числитель и знаменатель" onClose={sheet.close}>
        <div class="hint" style={{ fontSize: 13.5 }}>Бывает, что пары чередуются через неделю. Если у вас так — скажи, какая неделя сейчас.</div>
        {([['numerator', 'Да, сейчас числитель'], ['denominator', 'Да, сейчас знаменатель'], [null, 'Нет, каждую неделю одинаково']] as const).map(([v, title]) => (
          <button key={title} class="link-row" onClick={() => { store.setCurrentWeek(v); onDone?.(); sheet.close() }}>{title}</button>
        ))}
      </Sheet>
    )
  }

  return (
    <Sheet closing={sheet.closing} title="Звонки" onClose={sheet.close}
      action={<button class="btn primary" onClick={() => { store.setBells(slots, scope || undefined); if (store.weekParity(new Date()) == null && !store.classes().length) setStep('parity'); else { onDone?.(); sheet.close() } }}>Готово</button>}>
      <div>
        <div class="label">Для каких дней</div>
        <Segments value={scope} onChange={switchScope} options={[{ value: 0, title: 'Все' }, ...[...new Set([...store.scheduleDays(), ...(scope ? [scope] : [])])].sort().map((d) => ({ value: d, title: weekdayShort[d - 1] }))]} />
        {scope > 0 && (
          <div class="hint" style={{ marginTop: 6 }}>
            {store.dayBells(scope) ? `Особые звонки: ${weekdayNames[scope - 1].toLowerCase()}. ` : `${weekdayNames[scope - 1]} пока идёт по общим звонкам — задай свои. `}
            {store.dayBells(scope) && <button class="btn-text" style={{ padding: 0, fontSize: 12.5 }} onClick={() => { store.clearDayBells(scope); sheet.close() }}>Вернуть общие</button>}
          </div>
        )}
      </div>
      <div class="row"><span class="grow">Первая пара начинается в</span><TimeInput value={p.first} onChange={(m) => update({ first: m })} /></div>
      <div>
        <div class="label">Сколько идёт пара</div>
        <Segments value={p.length} onChange={(v) => update({ length: v })} options={[80, 90, 95, 100].map((m) => ({ value: m, title: `${m} мин` }))} />
      </div>
      <div>
        <div class="label">Перемена</div>
        <Segments value={p.pause} onChange={(v) => update({ pause: v })} options={[5, 10, 15, 20].map((m) => ({ value: m, title: `${m} мин` }))} />
      </div>
      <div>
        <div class="label">Большой перерыв — после какой пары</div>
        <Segments value={p.bigAfter} onChange={(v) => update({ bigAfter: v })} options={[0, 1, 2, 3, 4].map((n) => ({ value: n, title: n ? String(n) : 'Нет' }))} />
        {p.bigAfter > 0 && (
          <div style={{ marginTop: 8 }}>
            <div class="label">Сколько длится, мин</div>
            <Segments value={p.bigPause} onChange={(v) => update({ bigPause: v })} options={[20, 30, 40, 50, 60].map((m) => ({ value: m, title: `${m}` }))} />
          </div>
        )}
      </div>
      <div>
        <div class="label">Сколько пар бывает максимум</div>
        <Segments value={p.count} onChange={(v) => update({ count: v })} options={[4, 5, 6, 7, 8].map((n) => ({ value: n, title: String(n) }))} />
      </div>
      <div class="section" style={{ gap: 6 }}>
        <div class="label" style={{ margin: 0 }}>Получилось — можно поправить</div>
        {slots.map((s, i) => (
          <div key={i} class="row">
            <b style={{ width: 54 }}>{i + 1} пара</b>
            <TimeInput value={s.start} onChange={(m) => editSlot(i, 'start', m)} />
            <span class="hint">—</span>
            <TimeInput value={s.end} onChange={(m) => editSlot(i, 'end', m)} />
          </div>
        ))}
      </div>
    </Sheet>
  )
}

// MARK: - Сетка недели

/** Дни × номера пар. Нажал на клетку — вписал предмет; клетка делится на числитель и знаменатель. */
export function ScheduleGrid({ shown, onDayBells }: { shown: WeekParity | null; onDayBells: (day: number) => void }) {
  const bells = store.bells()
  const [cell, setCell] = useState<{ day: number; slot: number } | null>(null)
  const [copyFrom, setCopyFrom] = useState<number | null>(null)
  const all = store.classes()
  const days = store.scheduleDays()
  const hiddenWeekend = [6, 7].filter((d) => !days.includes(d))
  const today = ((new Date().getDay() + 6) % 7) + 1
  const dayBells = new Map(days.map((d) => [d, store.bellsFor(d)]))
  const custom = new Set(days.filter((d) => store.dayBells(d)))
  const rows = Math.max(0, ...[...dayBells.values()].map((b) => b.length))
  const offGrid = all.filter((c) => slotIndex(dayBells.get(c.weekday) ?? bells, c.startMin) == null)
  const offDays = store.offBellDays()

  return (
    <div class="section">
      {offDays.length > 0 && bells.length > 0 && (
        // Пары дня не попадают в общие звонки — у этого дня своё время (ВУЦ, физра, другой корпус)
        <div class="card section" style={{ border: '1.5px solid rgba(99,168,255,0.45)' }}>
          <div>
            <div class="toggle-title">{offDays.map((d) => weekdayNames[d - 1]).join(', ')}: пары по своему времени</div>
            <div class="hint" style={{ fontSize: 12.5, marginTop: 2 }}>Они не совпадают с общими звонками, поэтому в сетке съезжают. Пусть у {offDays.length > 1 ? 'этих дней' : 'этого дня'} будут свои звонки:</div>
          </div>
          <div class="row wrap">
            {offDays.map((d) => (
              <button key={d} class="btn secondary" onClick={() => { store.fitDayBells(d); showToast(`${weekdayNames[d - 1]}: свои звонки по парам`) }}>
                Подстроить: {weekdayShort[d - 1]}
              </button>
            ))}
          </div>
        </div>
      )}
      {!rows && <div class="empty">Сначала задай звонки: значок настроек сверху справа → «Звонки»</div>}
      {rows > 0 && <div class="grid-wrap">
        <div class="sgrid" style={{ gridTemplateColumns: `34px repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map((d) => (
            <button key={d} class={'sgrid-day' + (d === today ? ' today' : '') + (custom.has(d) ? ' custom' : '')} onClick={() => setCopyFrom(d)}
              aria-label={`${weekdayNames[d - 1]}${custom.has(d) ? ', свои звонки' : ''}: скопировать или задать звонки`}>
              {weekdayShort[d - 1]}{custom.has(d) && <i class="sgrid-dot" />}
            </button>
          ))}
          {[...Array(rows)].map((_, i) => (
            <Fragment key={i}>
              <div class="sgrid-time"><b>{i + 1}</b>{bells[i] ? time(bells[i].start) : ''}</div>
              {days.map((d) => {
                const own = dayBells.get(d)!
                if (!own[i]) return <div key={`${d}-${i}`} />
                const here = all.filter((c) => c.weekday === d && slotIndex(own, c.startMin) === i)
                // Подгруппы — через «/»
                const titles = (p: WeekParity) => here.filter((c) => c.parity === p).map((c) => c.title).join(' / ') || null
                const every = titles('every')
                const num = titles('numerator')
                const den = titles('denominator')
                const dim = (p: WeekParity) => shown != null && p !== shown
                return (
                  <button key={`${d}-${i}`} class={'sgrid-cell' + (here.length ? ' filled' : '')} onClick={() => setCell({ day: d, slot: i })}>
                    {custom.has(d) && <span class="sgrid-own-time">{time(own[i].start)}</span>}
                    {every && <span class="sgrid-item">{every}</span>}
                    {(num || den) && (
                      <>
                        <span class={'sgrid-item half' + (dim('numerator') ? ' dim' : '')}>{num ?? '—'}</span>
                        <span class={'sgrid-item half' + (dim('denominator') ? ' dim' : '')}>{den ?? '—'}</span>
                      </>
                    )}
                    {!here.length && <Plus size={12} color="var(--line)" />}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>}
      {hiddenWeekend.length > 0 && (
        <div class="row" style={{ gap: 8 }}>
          {hiddenWeekend.map((d) => (
            <button key={d} class="chip" style={{ background: 'var(--card)', color: 'var(--secondary)', height: 32, padding: '0 12px', fontSize: 13 }}
              onClick={() => store.setWeekendDay(d, true)}>
              <Plus size={13} /> {weekdayNames[d - 1]}
            </button>
          ))}
        </div>
      )}
      <div class="hint">Нажми на клетку, чтобы вписать пару. На день недели — чтобы скопировать его или задать свои звонки.</div>
      {offGrid.length > 0 && <div class="hint">Не по звонкам: {offGrid.map((c) => `${weekdayShort[c.weekday - 1]} ${time(c.startMin)} ${c.title}`).join(', ')} — видно в списке</div>}

      {cell && <CellEditor day={cell.day} slot={store.bellsFor(cell.day)[cell.slot]} index={cell.slot} onClose={() => setCell(null)} />}
      {copyFrom && <CopyDay from={copyFrom} days={days} onClose={() => setCopyFrom(null)} onDayBells={() => { const d = copyFrom; setCopyFrom(null); onDayBells(d) }} />}
    </div>
  )
}

const kinds = ['Лекция', 'Практика', 'Семинар', 'Лабораторная работа', 'Консультация', 'Зачёт', 'Экзамен']

/** Тип занятия — выпадающим списком. Подгруппа («Лекция · 1 подгр.») сохраняется; свой тип с Mac — тоже в списке. */
export function KindSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = value.split(/\s*·\s*/).filter(Boolean)
  const sub = parts.filter((x) => /подгр/.test(x))
  const base = parts.filter((x) => !/подгр/.test(x)).join(' · ')
  const options = base && !kinds.includes(base) ? [...kinds, base] : kinds
  return (
    <div class="field">
      <select aria-label="Тип занятия" style={{ flex: 1, background: 'none', border: 0, padding: '10px 0', color: base ? undefined : 'var(--secondary)' }}
        value={base} onChange={(e) => onChange([e.currentTarget.value, ...sub].filter(Boolean).join(' · '))}>
        <option value="">Тип занятия — не указан</option>
        {options.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      {sub.length > 0 && <span class="hint" style={{ flex: 'none' }}>{sub.join(', ')}</span>}
    </div>
  )
}

/** Подсказки предметов в редакторе пары (вкладка «По дням») — как в сетке */
export function SubjectSuggestions({ title, onPick }: { title: string; onPick: (c: ClassSlot) => void }) {
  const q = title.trim().toLowerCase()
  if (!q) return null
  const byTitle = new Map<string, ClassSlot>()
  for (const c of [...store.classes()].sort((a, b) => b.updatedAt - a.updatedAt)) if (!byTitle.has(c.title)) byTitle.set(c.title, c)
  const matches = [...byTitle.values()].filter((c) => c.title.toLowerCase().includes(q) && c.title.toLowerCase() !== q).slice(0, 4)
  if (!matches.length) return null
  return (
    <div class="row wrap" style={{ gap: 6 }}>
      {matches.map((c) => (
        <button key={c.id} class="chip" style={{ color: classColor, background: tint(classColor, 0.16) }} onClick={() => onPick(c)}>{c.title}</button>
      ))}
    </div>
  )
}

/** Поле «Преподаватель» с подсказками: Komet помнит преподов, как и предметы.
 *  Пустое поле у знакомого предмета — подсказка, кто его ведёт; начал печатать — совпадения по фамилии. */
/** Подсказка под полем, если значение не прошло проверку */
function FieldProblem({ text }: { text: string | null }) {
  return text ? <div class="field-problem">{text}</div> : null
}

/** Проверяем только то, что ввели или поменяли сейчас: старые данные (с Mac, из вставки) не мешают сохранить */
export const fieldInvalid = (value: string, original: string, problem: (v: string) => string | null) =>
  value.trim() !== original.trim() && problem(value) != null

/** Поле «Аудитория»: номер с цифрами (1230а, 5-12) или понятное место (спортзал, онлайн) */
export function RoomField({ value, original = '', onChange }: { value: string; original?: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false)
  const problem = !focused && fieldInvalid(value, original, roomProblem) ? roomProblem(value) : null
  return (
    <div class="section" style={{ gap: 4 }}>
      <div class={'field' + (problem ? ' invalid' : '')}><input placeholder="Аудитория" value={value} inputMode="text" onInput={(e) => onChange(e.currentTarget.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} /></div>
      <FieldProblem text={problem} />
    </div>
  )
}

export function TeacherField({ value, subject, onChange, original = '', placeholder = 'Преподаватель: Иванов Иван Иванович' }: { value: string; subject: string; onChange: (v: string) => void; original?: string; placeholder?: string }) {
  const [focused, setFocused] = useState(false)
  const problem = !focused && fieldInvalid(value, original, teacherProblem) ? teacherProblem(value) : null
  const q = value.trim().toLowerCase().replace(/ё/g, 'е')
  const usual = !q ? store.teacherOf(subject) : null
  const all = store.knownTeachers()
  // Последний преподаватель в списке через запятую — то, что печатают сейчас
  const typed = q.split(/\s*[,;]\s*/)
  const current = typed.pop() ?? ''
  const already = new Set(typed.map((t) => t.trim()).filter(Boolean))
  const norm = (t: string) => t.toLowerCase().replace(/ё/g, 'е').trim()
  const candidates = all.filter((t) => !already.has(norm(t)) && norm(t) !== current)
  const found = current
    ? candidates.filter((t) => norm(t).split(/\s+/).some((w) => w.startsWith(current))).slice(0, 4)
    : focused && !usual ? candidates.slice(0, 4) : []
  /** Выбранный — вместо того, что печатают сейчас; уже вписанные остаются */
  const pick = (t: string) => {
    const parts = value.split(/\s*[,;]\s*/).map((x) => x.trim())
    parts[parts.length - 1] = t
    onChange(parts.filter(Boolean).join(', '))
  }
  return (
    <div class="section" style={{ gap: 6 }}>
      <div class={'field' + (problem ? ' invalid' : '')}><input placeholder={placeholder} value={value} autoCapitalize="words" onInput={(e) => onChange(e.currentTarget.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          // «иванов иван иванович» → с заглавных
          const v = e.currentTarget.value
          if (v !== capitalizeName(v)) onChange(capitalizeName(v))
          setTimeout(() => setFocused(false), 150)
        }} /></div>
      <FieldProblem text={problem} />
      {(usual || found.length > 0) && (
        <div class="row wrap" style={{ gap: 6 }}>
          {usual && <button class="chip" style={{ color: classColor, background: tint(classColor, 0.16) }} onClick={() => onChange(usual)}>{usual}</button>}
          {found.map((t) => (
            <button key={t} class="chip" style={{ color: 'var(--secondary)', background: 'var(--raised)' }} onClick={() => pick(t)}>{t}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Поля одной пары. update — частичная правка поверх свежего состояния: быстрый ввод не затирает соседние поля. */
function EntryForm({ entry, original, update, suggestions }: { entry: CellEntry; original?: ClassSlot; update: (patch: Partial<CellEntry>) => void; suggestions: ClassSlot[] }) {
  const q = entry.title.trim().toLowerCase()
  const matches = q ? suggestions.filter((s) => s.title.toLowerCase().includes(q) && s.title.toLowerCase() !== q).slice(0, 4) : []
  return (
    <div class="section" style={{ gap: 8 }}>
      <div class="field"><input placeholder="Предмет" value={entry.title} onInput={(e) => update({ title: e.currentTarget.value })} /></div>
      {matches.length > 0 && (
        <div class="row wrap" style={{ gap: 6 }}>
          {matches.map((s) => (
            // Подсказка из уже введённого — сразу с преподом, аудиторией и видом занятия
            <button key={s.id} class="chip" style={{ color: classColor, background: tint(classColor, 0.16) }}
              onClick={() => update({ title: s.title, teacher: entry.teacher || s.teacher, room: entry.room || s.room, kind: entry.kind || s.kind })}>
              {s.title}
            </button>
          ))}
        </div>
      )}
      <KindSelect value={entry.kind} onChange={(kind) => update({ kind })} />
      <RoomField value={entry.room} original={original?.room} onChange={(room) => update({ room })} />
      <TeacherField value={entry.teacher} original={original?.teacher} subject={entry.title} onChange={(teacher) => update({ teacher })} />
    </div>
  )
}

let formKeyNext = 0

function CellEditor({ day, slot, index, onClose }: { day: number; slot: BellSlot; index: number; onClose: () => void }) {
  const sheet = useSheet(onClose)
  const [inCell] = useState(() => store.classesOnWeekday(day).filter((c) => Math.abs(c.startMin - slot.start) <= 15))
  const entry = (c: ClassSlot | null, p: WeekParity): CellEntry =>
    ({ id: c?.id, key: c?.id ?? 'new' + formKeyNext++, parity: p, title: c?.title ?? '', teacher: c?.teacher ?? '', room: c?.room ?? '', kind: c?.kind ?? '' })
  /** Все пары клетки этой недели (две подгруппы — две записи); пустая клетка — одна пустая запись */
  const load = (p: WeekParity) => {
    const list = inCell.filter((c) => c.parity === p).map((c) => entry(c, p))
    return list.length ? list : [entry(null, p)]
  }
  const [split, setSplit] = useState(inCell.some((c) => c.parity !== 'every'))
  const [every, setEvery] = useState(() => load('every'))
  const [num, setNum] = useState(() => load('numerator'))
  const [den, setDen] = useState(() => load('denominator'))
  // Подсказки: каждый предмет один раз, самые свежие данные
  const suggestions = useMemo(() => {
    const byTitle = new Map<string, ClassSlot>()
    for (const c of [...store.classes()].sort((a, b) => b.updatedAt - a.updatedAt)) if (!byTitle.has(c.title)) byTitle.set(c.title, c)
    return [...byTitle.values()]
  }, [])
  const filled = (list: CellEntry[]) => list.some((e) => e.title.trim())
  const ids = (list: CellEntry[]) => list.map((e) => e.id).filter((x): x is string => !!x)

  /** Аудитория без цифр или препод не полностью — «Готово» ждёт исправления */
  const invalid = (split ? [...num, ...den] : every).some((e) => {
    if (!e.title.trim()) return false
    const o = inCell.find((c) => c.id === e.id)
    return fieldInvalid(e.room, o?.room ?? '', roomProblem) || fieldInvalid(e.teacher, o?.teacher ?? '', teacherProblem)
  })

  const save = () => {
    if (invalid) return
    // Числ./знам.: пары «каждую неделю» в клетке остаются (о них подсказка в редакторе).
    // «Каждую неделю»: клетка становится одной на обе недели — пары числителя и знаменателя уходят (о них тоже подсказка)
    const entries = split ? [...num, ...den] : every
    const opened = split ? [...ids(load('numerator')), ...ids(load('denominator'))] : inCell.map((c) => c.id)
    const converted = ids(entries).filter((id) => inCell.some((c) => c.id === id))
    store.setCell(day, slot, entries, [...new Set([...opened, ...converted])])
    sheet.close()
  }
  const as = (list: CellEntry[], p: WeekParity, keepID: boolean) => list.filter((e) => e.title.trim()).map((e) => ({ ...e, parity: p, id: keepID ? e.id : undefined, key: keepID ? e.key : 'new' + formKeyNext++ }))

  /** Список пар одной недели: обычно одна, у подгрупп — несколько */
  const editors = (list: CellEntry[], set: (f: (prev: CellEntry[]) => CellEntry[]) => void, p: WeekParity) => (
    <>
      {list.map((e, i) => (
        <div key={e.key ?? e.id} class="section" style={{ gap: 6 }}>
          {list.length > 1 && (
            <div class="row">
              <div class="label grow" style={{ margin: 0 }}>{i + 1}-я подгруппа</div>
              <button class="btn-text" style={{ color: 'var(--secondary)' }} onClick={() => set((prev) => prev.filter((_, j) => j !== i))}>Убрать</button>
            </div>
          )}
          <EntryForm entry={e} original={inCell.find((c) => c.id === e.id)} update={(x) => set((prev) => prev.map((y, j) => (j === i ? { ...y, ...x } : y)))} suggestions={suggestions} />
        </div>
      ))}
      {filled(list) && (
        <button class="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => set((prev) => [...prev, entry(null, p)])}>
          <Plus size={13} /> Ещё подгруппа
        </button>
      )}
    </>
  )

  return (
    <Sheet closing={sheet.closing} title={`${weekdayNames[day - 1]}, ${index + 1} пара`} onClose={sheet.close}
      action={<button class="btn primary" disabled={invalid} onClick={save}>Готово</button>}>
      <div class="hint" style={{ marginTop: -6 }}>{time(slot.start)} — {time(slot.end)}</div>
      <Segments value={split ? 'split' : 'every'} onChange={(v) => {
        const toSplit = v === 'split'
        // Переносим уже введённое, чтобы «Готово» без правок не стёрло пару
        if (toSplit && filled(every) && !filled(num) && !filled(den)) {
          setNum(as(every, 'numerator', true))
          setDen(as(every, 'denominator', false))
        }
        if (!toSplit && !filled(every) && (filled(num) || filled(den))) setEvery(as(filled(num) ? num : den, 'every', true))
        setSplit(toSplit)
      }} options={[{ value: 'every', title: 'Каждую неделю' }, { value: 'split', title: 'Числ. / знам.' }]} />
      {!split && editors(every, setEvery, 'every')}
      {!split && inCell.some((c) => c.parity !== 'every' && !every.some((e) => e.id === c.id)) && (
        <div class="hint">Уберутся из клетки: {inCell.filter((c) => c.parity !== 'every' && !every.some((e) => e.id === c.id)).map((c) => c.title).join(', ')}</div>
      )}
      {split && inCell.some((c) => c.parity === 'every' && ![...num, ...den].some((e) => e.id === c.id)) && (
        <div class="hint">Останутся каждую неделю: {inCell.filter((c) => c.parity === 'every' && ![...num, ...den].some((e) => e.id === c.id)).map((c) => c.title).join(', ')}</div>
      )}
      {split && (
        <>
          <div class="label" style={{ margin: 0 }}>Числитель</div>
          {editors(num, setNum, 'numerator')}
          <div class="label" style={{ margin: 0 }}>Знаменатель</div>
          {editors(den, setDen, 'denominator')}
        </>
      )}
      {inCell.length > 0 && (
        <div class="row"><button class="btn danger" onClick={() => { store.setCell(day, slot, [], inCell.map((c) => c.id)); sheet.close() }}><X size={14} /> Очистить клетку</button></div>
      )}
    </Sheet>
  )
}

function CopyDay({ from, days, onClose, onDayBells }: { from: number; days: number[]; onClose: () => void; onDayBells: () => void }) {
  const sheet = useSheet(onClose)
  const count = store.classesOnWeekday(from).length
  const own = store.dayBells(from)
  return (
    <Sheet closing={sheet.closing} title={weekdayNames[from - 1]} onClose={sheet.close}>
      <button class="link-row" onClick={onDayBells}>
        <b class="grow">{own ? 'Свои звонки этого дня' : 'Задать свои звонки этому дню'}</b>
        <span class="hint">{own ? `с ${time(own[0].start)}` : 'например, ВУЦ'}</span>
      </button>
      {own && <button class="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => { store.clearDayBells(from); sheet.close() }}>Вернуть общие звонки</button>}
      {from >= 6 && count === 0 && (
        <button class="btn-text" style={{ alignSelf: 'flex-start', color: 'var(--secondary)' }} onClick={() => { store.setWeekendDay(from, false); sheet.close() }}>
          Убрать {from === 6 ? 'субботу' : 'воскресенье'} из расписания
        </button>
      )}
      {count === 0 ? <div class="hint">В этот день пар нет — копировать нечего</div> : (
        <>
          <div class="hint" style={{ fontSize: 13.5 }}><Copy size={13} /> Скопировать {count} {plural(count, 'пару', 'пары', 'пар')} на другой день — пары того дня заменятся:</div>
          <div class="row wrap">
            {days.filter((d) => d !== from).map((d) => (
              <button key={d} class="btn secondary" onClick={() => { store.copyDay(from, d); showToast(`Скопировано на ${weekdayNames[d - 1].toLowerCase()}`); sheet.close() }}>
                {weekdayShort[d - 1]}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}

// MARK: - Вставка текста и календарь

/** Вставка расписания текстом (в том числе с фото через Live Text) или файлом календаря — с проверкой перед добавлением. */
export function ScheduleImport({ mode, onClose }: { mode: 'text' | 'ics'; onClose: () => void }) {
  const sheet = useSheet(onClose)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedClass[] | null>(null)
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [replace, setReplace] = useState(store.classes().length > 0 ? false : true)
  const fileRef = useRef<HTMLInputElement>(null)
  const bells = store.bells()

  // Добавятся только выбранные пары, у которых есть время (из строки или по звонкам)
  const addable = (parsed ?? []).filter((c, i) => !skip.has(i) && c.startMin != null).length

  const parseText = () => {
    // «3 пара» во вторник — по звонкам вторника, если у него свои; явно написанное время не трогаем
    setParsed(parseScheduleText(text, (d) => store.bellsFor(d)))
    setSkip(new Set())
  }
  const parseFile = async (file: File) => {
    const raw = await file.text()
    // Если неделя не выбрана — считаем, что сейчас числитель (и потом так и запомним)
    const parityOf = (d: Date) => store.weekParity(d) ?? (Math.round((store.weekStart(d) - store.weekStart(new Date())) / (7 * 86_400_000)) % 2 === 0 ? 'numerator' : 'denominator')
    setParsed(parseICS(raw, parityOf, bells))
    setSkip(new Set())
  }
  const add = () => {
    const chosen = (parsed ?? []).filter((_, i) => !skip.has(i))
    const missingTime = chosen.filter((c) => c.startMin == null).length
    // Неделю спрашиваем, только если пары числителя/знаменателя правда добавятся (у них есть время)
    if (store.weekParity(new Date()) == null && chosen.some((c) => c.parity !== 'every' && c.startMin != null)) store.setCurrentWeek('numerator')
    const n = store.addParsedClasses(chosen, replace)
    showToast(`Добавлено пар: ${n}` + (missingTime ? ` · без времени пропущено: ${missingTime}` : ''))
    sheet.close()
  }

  return (
    <Sheet closing={sheet.closing} title={mode === 'text' ? 'Вставить расписание' : 'Календарь (.ics)'} onClose={sheet.close}
      action={addable > 0 ? <button class="btn primary" onClick={add}>Добавить {addable}</button> : undefined}>
      {!parsed && mode === 'text' && (
        <>
          <div class="hint" style={{ fontSize: 13, lineHeight: 1.45 }}>
            Вставь расписание из чата или с сайта вуза — по строке на пару, дни заголовками. Например:<br />
            <span style={{ color: 'var(--text)' }}>Понедельник<br />1 пара Матанализ лекция ауд. 301 Иванов И.И.<br />2 пара Физика практика 214 (числ.)</span>
          </div>
          <div class="hint" style={{ fontSize: 12.5 }}>📷 С фото: открой картинку, зажми текст → «Выбрать все» → «Скопировать» и вставь сюда.</div>
          <div class="field"><textarea rows={8} placeholder="Вставь сюда" value={text} onInput={(e) => setText(e.currentTarget.value)} /></div>
          <button class="btn primary" disabled={!text.trim()} onClick={parseText}><ClipboardPaste size={16} /> Разобрать</button>
        </>
      )}
      {!parsed && mode === 'ics' && (
        <>
          <div class="hint" style={{ fontSize: 13, lineHeight: 1.45 }}>
            Многие сайты расписаний умеют «Экспорт в календарь» или «Добавить в Google Календарь» — скачай файл .ics и выбери его здесь.
          </div>
          <button class="btn primary" onClick={() => fileRef.current?.click()}><CalendarPlus size={16} /> Выбрать файл</button>
          <input ref={fileRef} type="file" accept=".ics,text/calendar" style={{ display: 'none' }}
            onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) parseFile(f); e.currentTarget.value = '' }} />
        </>
      )}
      {parsed && (
        <>
          {!parsed.length && <div class="empty">Не получилось найти пары. Проверь, что дни недели написаны заголовками или в начале строк.</div>}
          {parsed.length > 0 && <div class="hint">Нашлось {parsed.length}. Сними галочку с лишнего:</div>}
          {parsed.map((c, i) => (
            <button key={i} class="class-row" style={{ textAlign: 'left', opacity: skip.has(i) ? 0.35 : 1 }}
              onClick={() => { const s = new Set(skip); s.has(i) ? s.delete(i) : s.add(i); setSkip(s) }}>
              <div class="class-time">{weekdayShort[c.weekday - 1]}<small>{c.startMin != null ? time(c.startMin) : c.number ? `${c.number} пара` : '?'}</small></div>
              <div class="grow">
                <span class="pill" style={{ color: classColor, background: tint(classColor, 0.16) }}>{c.title}</span>
                <div class="class-details">{[c.kind, c.room, c.teacher, c.parity === 'numerator' ? 'Числитель' : c.parity === 'denominator' ? 'Знаменатель' : ''].filter(Boolean).join(' · ') || ' '}</div>
              </div>
            </button>
          ))}
          {parsed.some((c) => c.startMin == null) && (
            <div class="hint danger-text">
              {store.hasBells() || bells.length ? 'У некоторых пар нет ни времени, ни номера пары — они не добавятся' : 'Для пар без времени задай звонки — иначе они не добавятся'}
            </div>
          )}
          {store.classes().length > 0 && parsed.length > 0 && (
            <Segments value={replace ? 'replace' : 'add'} onChange={(v) => setReplace(v === 'replace')} options={[{ value: 'add', title: 'Добавить к текущему' }, { value: 'replace', title: 'Заменить всё' }]} />
          )}
          <button class="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => setParsed(null)}>← Назад</button>
        </>
      )}
    </Sheet>
  )
}
