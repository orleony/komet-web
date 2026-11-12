import { useState } from 'preact/hooks'
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-preact'
import { parityTitle } from '../model'
import type { ClassSlot, TaskItem } from '../model'
import { addDays, dayHeader, daysLeft, duration, isoWeekday, minutesOfDay, startOfDay, startOfToday, time, toDate, todayTitle, weekdayShort } from '../lib/dates'
import * as store from '../store'
import { Screen, areaColor, describeDue } from '../ui/controls'
import { SmartCapture, TaskList, TaskRow } from '../ui/tasks'
import { ClassRow, WeekParityPrompt } from './schedule'

export function Today() {
  const now = store.clock.value
  const parity = store.prefs.value.showSchedule ? store.weekParity(now) : null
  const [showAll, setShowAll] = useState(false)
  const plan = store.plan()
  const undated = store.undated()
  const done = store.doneToday()

  // На «Сегодня» — только то, что горит: просрочено, сегодня, завтра
  // Время задачи вышло — она уже в «Просрочено», даже если день сегодняшний
  const overdue = plan.filter((t) => store.isOverdue(t, now))
  const today = plan.filter((t) => daysLeft(toDate(t.dueDate)!) === 0 && !store.isOverdue(t, now))
  const tomorrow = plan.filter((t) => daysLeft(toDate(t.dueDate)!) === 1)
  const later = plan.filter((t) => daysLeft(toDate(t.dueDate)!) > 1)
  const restCount = later.length + undated.length

  return (
    <Screen title="Сегодня" subtitle={todayTitle(now) + (parity ? ' · ' + parityTitle[parity].toLowerCase() : '')}>
      <NowCard />
      <SmartCapture />
      {store.prefs.value.showSchedule && <WeekParityPrompt />}
      {store.prefs.value.showSchedule && <TodayClasses />}
      {!overdue.length && !today.length && !tomorrow.length && (
        <div class="empty">{restCount ? 'На сегодня и завтра ничего не горит' : 'Планов нет — запиши что-нибудь в строку сверху'}</div>
      )}
      <TaskList title="Просрочено" tasks={overdue} color="var(--danger)" />
      <TaskList title="Сегодня" tasks={today} />
      <TaskList title="Завтра" tasks={tomorrow} />

      <MiniCalendar />

      {restCount > 0 && (
        <div class="section">
          <button class="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll(!showAll)}>
            Все задачи <span style={{ opacity: 0.6 }}>{restCount}</span>
            <ChevronDown size={16} style={{ transform: showAll ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
          {showAll && (
            <>
              {groupByDay(later).map((g) => <TaskList key={g.title} title={g.title} tasks={g.items} />)}
              <TaskList title="Без срока" tasks={undated} />
            </>
          )}
        </div>
      )}
      <TaskList title="Сделано сегодня" tasks={done} />
    </Screen>
  )
}

function groupByDay(tasks: TaskItem[]): { title: string; items: TaskItem[] }[] {
  const groups: { title: string; items: TaskItem[] }[] = []
  for (const t of tasks) {
    const title = dayHeader(toDate(t.dueDate)!)
    if (groups.length && groups[groups.length - 1].title === title) groups[groups.length - 1].items.push(t)
    else groups.push({ title, items: [t] })
  }
  return groups
}

// MARK: - Мини-календарь

const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

/** Месяц с точками цвета разделов: видно, на какие дни что приходится. Нажал на день — его задачи. */
function MiniCalendar() {
  const todayStart = startOfToday()
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const month = new Date(todayStart.getFullYear(), todayStart.getMonth() + offset, 1)
  const first = addDays(month, -(isoWeekday(month) - 1))
  const days = [...Array(42)].map((_, i) => addDays(first, i))
  const visible = days[35].getMonth() === month.getMonth() ? days : days.slice(0, 35)

  // Открытые задачи со сроком — по дням
  const byDay = new Map<number, TaskItem[]>()
  for (const t of store.plan()) {
    const key = startOfDay(toDate(t.dueDate)!).getTime()
    byDay.set(key, [...(byDay.get(key) ?? []), t])
  }
  const selectedTasks = selected != null ? byDay.get(selected) ?? [] : []

  return (
    <div class="card section" style={{ gap: 8 }}>
      <div class="row">
        <div class="toggle-title grow">{monthNames[month.getMonth()]} {month.getFullYear() !== todayStart.getFullYear() ? month.getFullYear() : ''}</div>
        {offset !== 0 && <button class="btn-text" style={{ fontSize: 13 }} onClick={() => { setOffset(0); setSelected(null) }}>Сегодня</button>}
        <button class="icon-btn" onClick={() => { setOffset(offset - 1); setSelected(null) }} aria-label="Прошлый месяц"><ChevronLeft size={18} /></button>
        <button class="icon-btn" onClick={() => { setOffset(offset + 1); setSelected(null) }} aria-label="Следующий месяц"><ChevronRight size={18} /></button>
      </div>
      <div class="cal">
        {weekdayShort.map((d) => <div key={d} class="cal-head">{d}</div>)}
        {visible.map((d) => {
          const key = d.getTime()
          const tasks = byDay.get(key) ?? []
          const colors = [...new Set(tasks.map((t) => areaColor(store.areaOf(t))))]
          const isToday = key === todayStart.getTime()
          const other = d.getMonth() !== month.getMonth()
          return (
            <button key={key} class={'cal-day' + (isToday ? ' today' : '') + (selected === key ? ' on' : '') + (other ? ' other' : '')}
              onClick={() => setSelected(selected === key ? null : key)}>
              <span>{d.getDate()}</span>
              <span class="cal-dots">
                {colors.slice(0, 3).map((c) => <i key={c} style={{ background: c }} />)}
                {colors.length > 3 && <i style={{ background: 'var(--secondary)' }} />}
              </span>
            </button>
          )
        })}
      </div>
      {selected != null && (
        <div class="section" style={{ marginTop: 4 }}>
          <div class="section-head">{dayHeader(new Date(selected))}</div>
          {selectedTasks.length ? selectedTasks.map((t) => <TaskRow key={t.id} task={t} />) : <div class="hint">Задач нет</div>}
        </div>
      )}
    </div>
  )
}

/** Самое важное прямо сейчас — горящая задача или идущая пара. */
function NowCard() {
  const now = store.clock.value
  const item = store.nowItem(now)
  if (!item) return null
  const minute = minutesOfDay(now)
  if (item.kind === 'task') return <TaskCard task={item.task} />
  const slot = item.slot
  const line = item.kind === 'current'
    ? `до ${time(slot.endMin)} · ещё ${duration(slot.endMin - minute)}`
    : `в ${time(slot.startMin)} · через ${duration(slot.startMin - minute)}`
  return <ClassCard label={item.kind === 'current' ? 'Сейчас идёт' : 'Дальше'} slot={slot} line={line} />
}

function TaskCard({ task }: { task: TaskItem }) {
  const due = describeDue(toDate(task.dueDate)!, false, task.dueTime ?? null)
  return (
    <div class="card row" style={{ padding: 18, borderRadius: 20 }}>
      <div class="grow">
        <div class="kicker">Сейчас важнее всего</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', margin: '4px 0' }}>{task.title}</div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          <span style={{ color: 'var(--secondary)' }}>{store.areaOf(task).title} · </span>
          <span style={{ color: due.color }}>{due.text}</span>
        </div>
      </div>
      <button class="circle-btn" onClick={() => store.toggleTask(task)} aria-label="Готово"><Check size={18} /></button>
    </div>
  )
}

function ClassCard({ label, slot, line }: { label: string; slot: ClassSlot; line: string }) {
  return (
    <div class="card" style={{ padding: 18, borderRadius: 20 }}>
      <div class="kicker">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', margin: '4px 0' }}>{slot.title}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--secondary)' }}>{[line, slot.kind, slot.room].filter(Boolean).join(' · ')}</div>
    </div>
  )
}

function TodayClasses() {
  const now = store.clock.value
  const slots = store.classesOn(now)
  if (!slots.length) {
    return store.classes().length
      ? <div class="section-head">Пар сегодня нет</div>
      : store.prefs.value.showSchedule ? <div class="hint">Добавь пары во вкладке «Пары» — они будут показываться здесь</div> : null
  }
  return (
    <div class="section">
      <div class="section-head">Пары <span class="count">{slots.length}</span></div>
      {slots.map((s) => <ClassRow key={s.id} slot={s} now={now} />)}
    </div>
  )
}
