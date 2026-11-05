import { useState } from 'preact/hooks'
import { Bell, CalendarPlus, ClipboardPaste, Plus, Settings2 } from 'lucide-preact'
import { parityTitle, uuid } from '../model'
import type { ClassSlot, WeekParity } from '../model'
import { addDays, dayMonth, duration, isoWeekday, minutesOfDay, nowSec, startOfWeek, time, weekdayNames } from '../lib/dates'
import * as store from '../store'
import { Screen, Segments, Sheet, useSheet, palette, tint } from '../ui/controls'
import { BellsWizard, ScheduleGrid, ScheduleImport, ScheduleSetup, SubjectSuggestions, TeacherField } from './schedule-tools'

const classColor = palette[0]

export function ClassRow({ slot, now, onEdit, showParity }: { slot: ClassSlot; now?: Date; onEdit?: () => void; showParity?: boolean }) {
  const minute = now ? minutesOfDay(now) : -1
  const state = !now ? '' : minute >= slot.endMin ? 'past' : minute >= slot.startMin ? 'now' : ''
  const details = [slot.kind, slot.room, slot.teacher, showParity && slot.parity !== 'every' ? parityTitle[slot.parity] : ''].filter(Boolean).join(' · ')
  const status = !now ? '' : state === 'now' ? `идёт · ещё ${duration(slot.endMin - minute)}`
    : state === '' && slot.startMin - minute <= 180 ? `через ${duration(slot.startMin - minute)}` : ''
  return (
    <button class={'class-row ' + state} onClick={onEdit} style={{ textAlign: 'left', width: '100%' }}>
      <div class="class-time">{time(slot.startMin)}<small>{time(slot.endMin)}</small></div>
      <div class="grow">
        <div class="row" style={{ alignItems: 'flex-start' }}>
          <span class="pill" style={{ color: classColor, background: tint(classColor, 0.16) }}>{slot.title || 'Без названия'}</span>
          {status && <span class="due" style={{ color: state === 'now' ? 'var(--accent)' : 'var(--secondary)', fontSize: 12, marginLeft: 'auto', paddingTop: 6 }}>{status}</span>}
        </div>
        {details && <div class="class-details">{details}</div>}
      </div>
    </button>
  )
}

/** В расписании есть числитель и знаменатель, а какая сейчас неделя — не сказано: спрашиваем одной кнопкой.
 *  Иначе Komet показывает пары обеих недель сразу. */
export function WeekParityPrompt() {
  const now = store.clock.value
  const needs = store.weekParity(now) == null && store.classes().some((c) => c.parity !== 'every')
  if (!needs) return null
  return (
    <div class="card section" style={{ border: '1.5px solid rgba(99,168,255,0.45)' }}>
      <div>
        <div class="toggle-title">Какая сейчас неделя?</div>
        <div class="hint" style={{ fontSize: 12.5, marginTop: 2 }}>В расписании есть числитель и знаменатель — скажи один раз, дальше Komet посчитает сам</div>
      </div>
      <div class="row">
        <button class="btn secondary grow" onClick={() => store.setCurrentWeek('numerator')}>Числитель</button>
        <button class="btn secondary grow" onClick={() => store.setCurrentWeek('denominator')}>Знаменатель</button>
      </div>
    </div>
  )
}

export function Schedule() {
  const [shownParity, setShownParity] = useState<WeekParity | null>(null)
  const [editing, setEditing] = useState<{ slot: ClassSlot; isNew: boolean } | null>(null)
  const [weekMenu, setWeekMenu] = useState(false)
  const [tool, setTool] = useState<'bells' | 'text' | 'ics' | null>(null)
  const [bellsDay, setBellsDay] = useState<number | undefined>(undefined)
  const view = store.prefs.value.scheduleView
  const now = store.clock.value
  const current = store.weekParity(now)
  const shown = shownParity ?? current
  const isCurrent = shown === current
  const weekStart = addDays(startOfWeek(now), isCurrent ? 0 : 7)

  const add = (day: number) => {
    const last = store.classesOnWeekday(day).slice(-1)[0]
    // После поздней последней пары — не позже 22:00, чтобы время было настоящим
    const start = Math.min(last ? last.endMin + 10 : 9 * 60, 22 * 60)
    const t = nowSec()
    setEditing({
      isNew: true,
      slot: { id: uuid(), weekday: day, startMin: start, endMin: Math.min(start + 90, 23 * 60 + 59), title: '', teacher: '', room: '', kind: '', parity: shownParity ?? 'every', createdAt: t, updatedAt: t },
    })
  }

  return (
    <Screen
      title="Расписание"
      subtitle={shown ? parityTitle[shown] + (isCurrent ? ' · эта неделя' : ' · следующая неделя') : 'Пары по дням недели'}
      right={<button class="icon-btn filled" onClick={() => setWeekMenu(true)} aria-label="Настройки расписания"><Settings2 size={18} /></button>}
    >
      <ScheduleSetup onBells={() => { store.setPref('scheduleView', 'grid'); setTool('bells') }} onPaste={() => setTool('text')} onCalendar={() => setTool('ics')} />
      <WeekParityPrompt />
      {store.classes().length > 0 || store.hasBells() ? (
        <Segments value={view} onChange={(v) => store.setPref('scheduleView', v)} options={[{ value: 'grid', title: 'Сетка' }, { value: 'list', title: 'По дням' }]} />
      ) : null}
      <div class="row">
        {current && (
          <div class="grow">
            <Segments value={shown!} onChange={(p) => setShownParity(p)} options={[{ value: 'numerator', title: 'Числитель' }, { value: 'denominator', title: 'Знаменатель' }]} />
          </div>
        )}
        <button class="chip" style={{ color: classColor, background: tint(classColor, 0.16), height: 34, padding: '0 12px', marginLeft: current ? 0 : 'auto' }} onClick={() => add(isoWeekday(now))}>
          <Plus size={14} /> Пара
        </button>
      </div>

      {view === 'grid' && (store.classes().length > 0 || store.hasBells()) && <ScheduleGrid shown={shown} onDayBells={(d) => { setBellsDay(d); setTool('bells') }} />}

      {view === 'list' && store.scheduleDays().map((day) => {
        const slots = store.classesOnWeekday(day).filter((s) => shown == null || s.parity === 'every' || s.parity === shown)
        const date = addDays(weekStart, day - 1)
        const isToday = isCurrent && isoWeekday(now) === day
        return (
          <div key={day} class="section">
            <div class="row">
              <div class="section-head grow" style={isToday ? { color: 'var(--accent)' } : undefined}>
                {current ? `${dayMonth(date)} — ${weekdayNames[day - 1].toLowerCase()}` : weekdayNames[day - 1]}
                {isToday && ' · сегодня'} {slots.length > 0 && <span class="count">{slots.length}</span>}
              </div>
              <button class="icon-btn" onClick={() => add(day)} aria-label="Добавить пару"><Plus size={16} /></button>
            </div>
            {slots.length ? slots.map((s) => <ClassRow key={s.id} slot={s} now={isToday ? now : undefined} showParity={shown == null} onEdit={() => setEditing({ slot: s, isNew: false })} />)
              : <div class="hint">Нет пар</div>}
          </div>
        )
      })}

      {view === 'list' && [6, 7].some((d) => !store.scheduleDays().includes(d)) && (
        <div class="row" style={{ gap: 8 }}>
          {[6, 7].filter((d) => !store.scheduleDays().includes(d)).map((d) => (
            <button key={d} class="chip" style={{ background: 'var(--card)', color: 'var(--secondary)', height: 32, padding: '0 12px', fontSize: 13 }}
              onClick={() => store.setWeekendDay(d, true)}>
              <Plus size={13} /> {weekdayNames[d - 1]}
            </button>
          ))}
        </div>
      )}

      {editing && <ClassEditor slot={editing.slot} isNew={editing.isNew} onClose={() => setEditing(null)} />}
      {weekMenu && (
        <Sheet title="Расписание" onClose={() => setWeekMenu(false)}>
          <div class="label" style={{ margin: 0 }}>Какая сейчас неделя</div>
          {([['numerator', 'Эта неделя — числитель'], ['denominator', 'Эта неделя — знаменатель'], [null, 'Без деления на недели']] as const).map(([value, title]) => (
            <button key={title} class="link-row" style={value === current ? { color: 'var(--accent)' } : undefined}
              onClick={() => { store.setCurrentWeek(value); setShownParity(null); setWeekMenu(false) }}>
              {title}
            </button>
          ))}
          <div class="label" style={{ margin: '6px 0 0' }}>Заполнить</div>
          <button class="link-row" onClick={() => { setWeekMenu(false); setBellsDay(undefined); setTool('bells') }}><span class="ic"><Bell size={16} /></span><b class="grow">Звонки</b></button>
          <button class="link-row" onClick={() => { setWeekMenu(false); setTool('text') }}><span class="ic"><ClipboardPaste size={16} /></span><b class="grow">Вставить текстом или с фото</b></button>
          <button class="link-row" onClick={() => { setWeekMenu(false); setTool('ics') }}><span class="ic"><CalendarPlus size={16} /></span><b class="grow">Загрузить календарь (.ics)</b></button>
        </Sheet>
      )}
      {tool === 'bells' && <BellsWizard day={bellsDay} onClose={() => { setTool(null); setBellsDay(undefined) }} onDone={() => store.setPref('scheduleView', 'grid')} />}
      {(tool === 'text' || tool === 'ics') && <ScheduleImport mode={tool} onClose={() => setTool(null)} />}
    </Screen>
  )
}

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromTime = (v: string) => {
  const [h, m] = v.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

function ClassEditor({ slot, isNew, onClose }: { slot: ClassSlot; isNew: boolean; onClose: () => void }) {
  const sheet = useSheet(onClose)
  const [s, setS] = useState(slot)
  const set = <K extends keyof ClassSlot>(k: K, v: ClassSlot[K]) => setS((prev) => ({ ...prev, [k]: v }))
  const save = () => {
    store.saveClass({ ...s, title: s.title.trim(), endMin: Math.max(s.endMin, s.startMin + 5) })
    sheet.close()
  }
  return (
    <Sheet closing={sheet.closing} title={isNew ? 'Новая пара' : 'Пара'} onClose={sheet.close} action={<button class="btn primary" disabled={!s.title.trim()} onClick={save}>Готово</button>}>
      <div class="field"><input placeholder="Предмет" value={s.title} onInput={(e) => set('title', e.currentTarget.value)} /></div>
      <SubjectSuggestions title={s.title} onPick={(c) => setS((prev) => ({ ...prev, title: c.title, teacher: prev.teacher || c.teacher, room: prev.room || c.room, kind: prev.kind || c.kind }))} />
      <div class="row">
        <div class="grow">
          <div class="label">День</div>
          <div class="field">
            <select style={{ flex: 1, background: 'none', border: 0, padding: '10px 0' }} value={s.weekday} onChange={(e) => set('weekday', Number(e.currentTarget.value))}>
              {weekdayNames.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div class="label">Начало</div>
          <div class="field"><input type="time" value={toTime(s.startMin)} onInput={(e) => {
            const m = fromTime(e.currentTarget.value)
            // Конец едет вместе с началом: пара остаётся той же длины
            if (m != null) setS((prev) => ({ ...prev, startMin: m, endMin: Math.min(m + Math.max(prev.endMin - prev.startMin, 5), 23 * 60 + 59) }))
          }} /></div>
        </div>
        <div>
          <div class="label">Конец</div>
          <div class="field"><input type="time" value={toTime(s.endMin)} onInput={(e) => { const m = fromTime(e.currentTarget.value); if (m != null) set('endMin', m) }} /></div>
        </div>
      </div>
      <TeacherField value={s.teacher} subject={s.title} placeholder="Преподаватель (полностью)" onChange={(v) => set('teacher', v)} />
      <div class="row">
        <div class="field grow"><input placeholder="Аудитория" value={s.room} onInput={(e) => set('room', e.currentTarget.value)} /></div>
        <div class="field grow"><input placeholder="Лекция, семинар…" value={s.kind} onInput={(e) => set('kind', e.currentTarget.value)} /></div>
      </div>
      <div>
        <div class="label">Когда</div>
        <Segments value={s.parity} onChange={(p) => set('parity', p)} options={[{ value: 'every', title: 'Каждую' }, { value: 'numerator', title: 'Числитель' }, { value: 'denominator', title: 'Знаменатель' }]} />
      </div>
      {!isNew && (
        <div class="row">
          <button class="btn danger" onClick={() => { if (confirm(`Удалить пару «${s.title}»?`)) { store.deleteClass(slot); sheet.close() } }}>Удалить пару</button>
        </div>
      )}
    </Sheet>
  )
}
