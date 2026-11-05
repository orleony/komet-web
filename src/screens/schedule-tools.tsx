// Ввод расписания: мастер звонков, сетка недели, вставка текста и календаря.
import { Fragment } from 'preact'
import { useMemo, useRef, useState } from 'preact/hooks'
import { CalendarPlus, ClipboardPaste, Copy, GraduationCap, Plus, X } from 'lucide-preact'
import type { ClassSlot, WeekParity } from '../model'
import { time, weekdayNames, weekdayShort } from '../lib/dates'
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
  if (store.classes().length || store.prefs.value.scheduleSetupDismissed) return null
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

/** Звонки одной анкетой: Komet сам строит сетку, любое время можно поправить. */
export function BellsWizard({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const sheet = useSheet(onClose)
  const existing = store.bells()
  const [step, setStep] = useState<'bells' | 'parity'>('bells')
  const [p, setP] = useState<BellParams>(defaultBellParams)
  const [slots, setSlots] = useState<BellSlot[]>(store.hasBells() || existing.length ? existing : computeBells(defaultBellParams))
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
      action={<button class="btn primary" onClick={() => { store.setBells(slots.slice().sort((a, b) => a.start - b.start)); if (store.weekParity(new Date()) == null && !store.classes().length) setStep('parity'); else { onDone?.(); sheet.close() } }}>Готово</button>}>
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
export function ScheduleGrid({ shown }: { shown: WeekParity | null }) {
  const bells = store.bells()
  const [cell, setCell] = useState<{ day: number; slot: number } | null>(null)
  const [copyFrom, setCopyFrom] = useState<number | null>(null)
  const all = store.classes()
  const days = all.some((c) => c.weekday === 7) ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6]
  const today = ((new Date().getDay() + 6) % 7) + 1
  const offGrid = all.filter((c) => slotIndex(bells, c.startMin) == null)

  if (!bells.length) return <div class="empty">Сначала задай звонки — кнопка «Звонки» сверху</div>

  return (
    <div class="section">
      <div class="grid-wrap">
        <div class="sgrid" style={{ gridTemplateColumns: `34px repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map((d) => (
            <button key={d} class={'sgrid-day' + (d === today ? ' today' : '')} onClick={() => setCopyFrom(d)} aria-label={`${weekdayNames[d - 1]}: скопировать`}>
              {weekdayShort[d - 1]}
            </button>
          ))}
          {bells.map((b, i) => (
            <Fragment key={i}>
              <div class="sgrid-time"><b>{i + 1}</b>{time(b.start)}</div>
              {days.map((d) => {
                const here = all.filter((c) => c.weekday === d && slotIndex(bells, c.startMin) === i)
                const every = here.find((c) => c.parity === 'every')
                const num = here.find((c) => c.parity === 'numerator')
                const den = here.find((c) => c.parity === 'denominator')
                const dim = (p: WeekParity) => shown != null && p !== shown
                return (
                  <button key={`${d}-${i}`} class={'sgrid-cell' + (here.length ? ' filled' : '')} onClick={() => setCell({ day: d, slot: i })}>
                    {every && <span class="sgrid-item">{every.title}</span>}
                    {!every && (num || den) && (
                      <>
                        <span class={'sgrid-item half' + (dim('numerator') ? ' dim' : '')}>{num?.title ?? '—'}</span>
                        <span class={'sgrid-item half' + (dim('denominator') ? ' dim' : '')}>{den?.title ?? '—'}</span>
                      </>
                    )}
                    {!here.length && <Plus size={12} color="var(--line)" />}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div class="hint">Нажми на клетку, чтобы вписать пару. На день недели — чтобы скопировать его.</div>
      {offGrid.length > 0 && <div class="hint">Не по звонкам: {offGrid.map((c) => `${weekdayShort[c.weekday - 1]} ${time(c.startMin)} ${c.title}`).join(', ')} — видно в списке</div>}

      {cell && <CellEditor day={cell.day} slot={bells[cell.slot]} index={cell.slot} onClose={() => setCell(null)} />}
      {copyFrom && <CopyDay from={copyFrom} days={days} onClose={() => setCopyFrom(null)} />}
    </div>
  )
}

const kinds = ['Лекция', 'Практика', 'Лабораторная работа', 'Семинар']

/** Поля одной пары. update — частичная правка поверх свежего состояния: быстрый ввод не затирает соседние поля. */
function EntryForm({ entry, update, suggestions }: { entry: CellEntry; update: (patch: Partial<CellEntry>) => void; suggestions: ClassSlot[] }) {
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
      <div class="row wrap" style={{ gap: 6 }}>
        {kinds.map((k) => (
          <button key={k} class="chip" style={{ background: entry.kind === k ? tint(classColor, 0.3) : 'var(--raised)', color: entry.kind === k ? '#fff' : 'var(--secondary)' }}
            onClick={() => update({ kind: entry.kind === k ? '' : k })}>{k === 'Лабораторная работа' ? 'Лаба' : k}</button>
        ))}
      </div>
      <div class="row">
        <div class="field grow"><input placeholder="Аудитория" value={entry.room} onInput={(e) => update({ room: e.currentTarget.value })} /></div>
        <div class="field" style={{ flex: 2 }}><input placeholder="Преподаватель" value={entry.teacher} onInput={(e) => update({ teacher: e.currentTarget.value })} /></div>
      </div>
    </div>
  )
}

function CellEditor({ day, slot, index, onClose }: { day: number; slot: BellSlot; index: number; onClose: () => void }) {
  const sheet = useSheet(onClose)
  const inCell = store.classesOnWeekday(day).filter((c) => Math.abs(c.startMin - slot.start) <= 15)
  const pick = (p: WeekParity): CellEntry => {
    const c = inCell.find((x) => x.parity === p)
    return { parity: p, title: c?.title ?? '', teacher: c?.teacher ?? '', room: c?.room ?? '', kind: c?.kind ?? '' }
  }
  const [split, setSplit] = useState(inCell.some((c) => c.parity !== 'every'))
  const [every, setEvery] = useState(pick('every').title ? pick('every') : { ...pick('numerator'), parity: 'every' as WeekParity })
  const [num, setNum] = useState(pick('numerator'))
  const [den, setDen] = useState(pick('denominator'))
  // Подсказки: каждый предмет один раз, самые свежие данные
  const suggestions = useMemo(() => {
    const byTitle = new Map<string, ClassSlot>()
    for (const c of [...store.classes()].sort((a, b) => b.updatedAt - a.updatedAt)) if (!byTitle.has(c.title)) byTitle.set(c.title, c)
    return [...byTitle.values()]
  }, [])

  const save = () => {
    store.setCell(day, slot, split ? [num, den] : [every])
    sheet.close()
  }
  return (
    <Sheet closing={sheet.closing} title={`${weekdayNames[day - 1]}, ${index + 1} пара`} onClose={sheet.close}
      action={<button class="btn primary" onClick={save}>Готово</button>}>
      <div class="hint" style={{ marginTop: -6 }}>{time(slot.start)} — {time(slot.end)}</div>
      <Segments value={split ? 'split' : 'every'} onChange={(v) => setSplit(v === 'split')} options={[{ value: 'every', title: 'Каждую неделю' }, { value: 'split', title: 'Числитель / знаменатель' }]} />
      {!split && <EntryForm entry={every} update={(x) => setEvery((prev) => ({ ...prev, ...x }))} suggestions={suggestions} />}
      {split && (
        <>
          <div class="label" style={{ margin: 0 }}>Числитель</div>
          <EntryForm entry={num} update={(x) => setNum((prev) => ({ ...prev, ...x }))} suggestions={suggestions} />
          <div class="label" style={{ margin: 0 }}>Знаменатель</div>
          <EntryForm entry={den} update={(x) => setDen((prev) => ({ ...prev, ...x }))} suggestions={suggestions} />
        </>
      )}
      {inCell.length > 0 && (
        <div class="row"><button class="btn danger" onClick={() => { store.setCell(day, slot, []); sheet.close() }}><X size={14} /> Очистить клетку</button></div>
      )}
    </Sheet>
  )
}

function CopyDay({ from, days, onClose }: { from: number; days: number[]; onClose: () => void }) {
  const sheet = useSheet(onClose)
  const count = store.classesOnWeekday(from).length
  return (
    <Sheet closing={sheet.closing} title={weekdayNames[from - 1]} onClose={sheet.close}>
      {count === 0 ? <div class="hint">В этот день пар нет — копировать нечего</div> : (
        <>
          <div class="hint" style={{ fontSize: 13.5 }}><Copy size={13} /> Скопировать {count} {count === 1 ? 'пару' : count < 5 ? 'пары' : 'пар'} на другой день — пары того дня заменятся:</div>
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

  const parseText = () => {
    setParsed(parseScheduleText(text, bells))
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
    if (store.weekParity(new Date()) == null && chosen.some((c) => c.parity !== 'every')) store.setCurrentWeek('numerator')
    const n = store.addParsedClasses(chosen, replace)
    showToast(`Добавлено пар: ${n}` + (missingTime ? ` · без времени пропущено: ${missingTime}` : ''))
    sheet.close()
  }

  return (
    <Sheet closing={sheet.closing} title={mode === 'text' ? 'Вставить расписание' : 'Календарь (.ics)'} onClose={sheet.close}
      action={parsed?.length ? <button class="btn primary" onClick={add}>Добавить {parsed.length - skip.size}</button> : undefined}>
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
          {parsed.some((c) => c.startMin == null) && <div class="hint danger-text">Для пар без времени задай звонки — иначе они не добавятся</div>}
          {store.classes().length > 0 && parsed.length > 0 && (
            <Segments value={replace ? 'replace' : 'add'} onChange={(v) => setReplace(v === 'replace')} options={[{ value: 'add', title: 'Добавить к текущему' }, { value: 'replace', title: 'Заменить всё' }]} />
          )}
          <button class="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => setParsed(null)}>← Назад</button>
        </>
      )}
    </Sheet>
  )
}
