import { Check } from 'lucide-preact'
import { parityTitle } from '../model'
import type { ClassSlot, TaskItem } from '../model'
import { duration, minutesOfDay, time, todayTitle, toDate } from '../lib/dates'
import * as store from '../store'
import { Screen, describeDue } from '../ui/controls'
import { SmartCapture, TaskList } from '../ui/tasks'
import { ClassRow } from './schedule'

export function Today() {
  const now = store.clock.value
  const parity = store.weekParity(now)
  const undated = store.undated()
  const done = store.doneToday()
  const groups = store.planByDay()
  return (
    <Screen title="Сегодня" subtitle={todayTitle(now) + (parity ? ' · ' + parityTitle[parity].toLowerCase() : '')}>
      <NowCard />
      <SmartCapture />
      <TodayClasses />
      {!groups.length && !undated.length && !done.length && <div class="empty">Планов нет — запиши что-нибудь в строку сверху</div>}
      {groups.map((g) => <TaskList key={g.title} title={g.title} tasks={g.items} color={g.title === 'Просрочено' ? 'var(--danger)' : undefined} />)}
      <TaskList title="Без срока" tasks={undated} />
      <TaskList title="Сделано сегодня" tasks={done} />
    </Screen>
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
  const due = describeDue(toDate(task.dueDate)!)
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
      : <div class="hint">Добавь пары во вкладке «Пары» — они будут показываться здесь</div>
  }
  return (
    <div class="section">
      <div class="section-head">Пары <span class="count">{slots.length}</span></div>
      {slots.map((s) => <ClassRow key={s.id} slot={s} now={now} />)}
    </div>
  )
}
