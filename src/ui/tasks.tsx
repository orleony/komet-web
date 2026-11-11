import { useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import { Check, Circle, CircleCheck, ArrowUp, Plus } from 'lucide-preact'
import { Priority, priorityTitle } from '../model'
import type { TaskItem } from '../model'
import { addDays, endOfWeek, startOfToday, toDate, toSec } from '../lib/dates'
import { analyze } from '../lib/text'
import type { CaptureKind } from '../lib/text'
import * as store from '../store'
import { AreaIcon } from './icons'
import { Segments, Sheet, useSheet, areaColor, describeDue, palette, priorityColor, showToast, tint } from './controls'

/** Какая задача открыта в редакторе. Редактор живёт отдельно от строки: задача сменила срок и уехала
 *  в другой список (или наступила полночь) — редактор не закрывается и правки не теряются. */
export const editingTask = signal<string | null>(null)

export function TaskEditorHost() {
  const id = editingTask.value
  // Задачу удалили или убрали в корзину (другая вкладка, автоочистка) — редактор закрываем
  const task = id ? store.data.value.tasks.find((t) => t.id === id && !t.deletedAt && !t.trashedAt) : null
  if (!task) {
    // Иначе после «Вернуть» редактор открылся бы сам
    if (id) queueMicrotask(() => { if (editingTask.peek() === id) editingTask.value = null })
    return null
  }
  return <TaskEditor key={id} task={task} onClose={() => { if (editingTask.peek() === id) editingTask.value = null }} />
}

/** Задача — цветная пилюля раздела, справа срок. Нажатие на пилюлю — изменить. */
export function TaskRow({ task }: { task: TaskItem }) {
  const [checking, setChecking] = useState(false)
  const done = task.isDone || checking
  const toggle = () => {
    if (task.isDone) return store.toggleTask(task)
    // Сначала видно, что отметили, — потом задача уезжает в «Сделано»
    setChecking(true)
    window.setTimeout(() => store.toggleTask(task), 450)
  }
  const area = store.areaOf(task)
  const color = areaColor(area)
  const due = toDate(task.dueDate)
  const info = due ? describeDue(due, task.isDone, task.dueTime ?? null) : null
  return (
    <div class={'task' + (checking ? ' checking' : '')}>
      <button class={'check' + (done ? ' on' : '')} onClick={toggle} aria-label="Готово">
        {done ? <CircleCheck size={22} color={color} /> : <Circle size={22} />}
      </button>
      <button class="body" onClick={() => (editingTask.value = task.id)}>
        {task.priority !== Priority.Normal && !task.isDone && (
          <span class="prio" style={{ color: priorityColor[task.priority] }}>{task.priority === Priority.Urgent ? '!!!' : '!!'}</span>
        )}
        <span class={'pill' + (done ? ' done' : '')} style={{ color, background: tint(color, 0.16) }}>{task.title}</span>
      </button>
      {info && <span class="due" style={{ color: info.color }}>{info.text}</span>}
    </div>
  )
}

export function TaskList({ title, tasks, color }: { title: string; tasks: TaskItem[]; color?: string }) {
  if (!tasks.length) return null
  return (
    <div class="section">
      <div class="section-head" style={color ? { color } : undefined}>
        {title} <span class="count">{tasks.length}</span>
      </div>
      {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
    </div>
  )
}

const duePresets: { id: string; title: string; date: () => Date | null }[] = [
  { id: 'none', title: 'Без даты', date: () => null },
  { id: 'today', title: 'Сегодня', date: () => startOfToday() },
  { id: 'tomorrow', title: 'Завтра', date: () => addDays(startOfToday(), 1) },
  { id: 'week', title: 'На неделе', date: () => endOfWeek() },
]

const dateInput = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''
const fromInput = (v: string) => {
  if (!v) return null
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function TaskEditor({ task: opened, onClose }: { task: TaskItem; onClose: () => void }) {
  const sheet = useSheet(onClose)
  // Свежая версия задачи (могла поменяться, пока редактор открыт), правки — поверх неё
  const task = store.data.value.tasks.find((t) => t.id === opened.id) ?? opened
  const [title, setTitle] = useState(task.title)
  const [details, setDetails] = useState(task.details)
  const [areaID, setAreaID] = useState(task.areaID)
  const [due, setDue] = useState<Date | null>(toDate(task.dueDate))
  const [time, setTime] = useState<number | null>(task.dueTime ?? null)
  const [priority, setPriority] = useState(task.priority)

  const save = () => {
    if (!title.trim()) return
    // Название — одной строкой (Enter в поле ничего не ломает)
    store.saveTask({ ...task, title: title.replace(/\s*\n+\s*/g, ' ').trim(), details, areaID, dueDate: toSec(due), dueTime: due ? time : null, priority })
    sheet.close()
  }

  return (
    <Sheet closing={sheet.closing} title="Задача" onClose={sheet.close} action={<button class="btn primary" disabled={!title.trim()} onClick={save}>Готово</button>}>
      <div class="field"><textarea rows={2} value={title} onInput={(e) => setTitle(e.currentTarget.value)} /></div>
      <div class="field"><textarea rows={3} placeholder="Подробности" value={details} onInput={(e) => setDetails(e.currentTarget.value)} /></div>
      <div>
        <div class="label">Раздел</div>
        <div class="row wrap">
          {[store.inbox, ...store.areas()].map((a) => {
            const c = areaColor(a)
            const on = a.id === areaID || (a.id === store.inbox.id && !store.areas().some((x) => x.id === areaID))
            return (
              <button key={a.id} class="chip" style={{ color: on ? '#fff' : c, background: on ? c : tint(c, 0.16) }} onClick={() => setAreaID(a.id)}>
                <AreaIcon name={a.icon} size={12} /> {a.title}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <div class="label">Срок</div>
        <div class="row">
          <div class="field grow"><input type="date" value={dateInput(due)} onInput={(e) => setDue(fromInput(e.currentTarget.value))} /></div>
          {due && <button class="btn-text" onClick={() => { setDue(null); setTime(null) }}>Убрать</button>}
        </div>
        {due && (
          // Ко времени — необязательно: без времени задача на весь день
          <div class="row" style={{ marginTop: 8 }}>
            <div class="field grow"><input type="time" aria-label="Время" value={time == null ? '' : `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`}
              onInput={(e) => { const [h, m] = e.currentTarget.value.split(':').map(Number); setTime(Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null) }} /></div>
            {time != null ? <button class="btn-text" onClick={() => setTime(null)}>Весь день</button> : <span class="hint">Без времени — весь день</span>}
          </div>
        )}
        <div class="row wrap" style={{ marginTop: 8 }}>
          {duePresets.slice(1).map((p) => (
            <button key={p.id} class="chip" style={{ background: 'var(--raised)' }} onClick={() => setDue(p.date())}>{p.title}</button>
          ))}
        </div>
      </div>
      <div>
        <div class="label">Важность</div>
        <Segments value={priority} onChange={setPriority} options={[Priority.Normal, Priority.Important, Priority.Urgent].map((p) => ({ value: p, title: priorityTitle[p] }))} />
      </div>
      <div class="row">
        <button class="btn danger" onClick={() => { store.deleteTask(task); showToast('Задача в корзине', 'Вернуть', () => store.restoreTask({ ...task, trashedAt: 1 })); sheet.close() }}>Удалить</button>
      </div>
    </Sheet>
  )
}

/** Строка добавления задачи в раздел. */
export function AddTaskBar({ areaID }: { areaID: string }) {
  const [text, setText] = useState('')
  const [preset, setPreset] = useState('none')
  const add = () => {
    if (!text.trim()) return
    // Срок и важность из самого текста, если сказано («сдать лабу до пятницы !!»)
    const parsed = analyze(text, store.studyHints()).tasks[0]
    const due = duePresets.find((p) => p.id === preset)!.date() ?? parsed?.dueDate ?? null
    store.addTask(parsed?.title ?? text, areaID, due, parsed?.priority ?? Priority.Normal, due ? parsed?.dueTime ?? null : null)
    setText('')
  }
  return (
    <div class="field">
      <input placeholder="Новая задача…" value={text} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} enterkeyhint="done" />
      {/* Нажатие перебирает сроки: без даты → сегодня → завтра → на неделе */}
      <button class="chip" style={{ flex: 'none', background: preset === 'none' ? 'var(--raised)' : 'rgba(255,90,60,0.16)', color: preset === 'none' ? 'var(--secondary)' : 'var(--accent)' }}
        onClick={() => setPreset(duePresets[(duePresets.findIndex((p) => p.id === preset) + 1) % duePresets.length].id)}>
        {duePresets.find((p) => p.id === preset)!.title}
      </button>
      <button class="circle-btn" onClick={add} aria-label="Добавить"><ArrowUp size={18} /></button>
    </div>
  )
}

/** Одна строка на всё: пишешь что угодно, Komet сам решает — задача (с разделом и сроком) или заметка. */
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

export function SmartCapture() {
  const [text, setText] = useState('')
  const [kindOverride, setKindOverride] = useState<CaptureKind | null>(null)
  const [areaOverride, setAreaOverride] = useState<string | null>(null)
  const trimmed = text.trim()
  const analysis = trimmed ? analyze(text, store.studyHints()) : null
  const kind = kindOverride ?? analysis?.kind ?? 'note'

  const suggestion = analysis?.tasks.find((t) => t.suggest)?.suggest

  const commit = () => {
    if (!analysis) return
    if (kind === 'note') {
      // «заметка: …» — подсказка для Komet, в саму заметку её не пишем
      // Убираем только служебное «заметка:»; «Идея: …», «План: …» — часть самой заметки
      const body = text.trim().replace(/^заметка\s*:\s*/iu, '')
      if (!body) return
      store.addNote(body)
      showToast('Заметка сохранена')
    } else {
      if (!analysis.tasks.length) return
      for (const t of analysis.tasks) {
        store.addTask(t.title, areaOverride ?? t.area.id, t.dueDate, t.priority, t.dueTime)
      }
      showToast(analysis.tasks.length > 1 ? `Добавлено задач: ${analysis.tasks.length}` : 'Задача добавлена')
    }
    setText('')
    setKindOverride(null)
    setAreaOverride(null)
  }

  return (
    <div class="section">
      <div class="field" style={{ alignItems: 'flex-end', padding: '4px 6px 4px 14px' }}>
        <textarea
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          placeholder="Запиши что угодно — сам разложу"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          enterkeyhint={touch ? 'enter' : 'send'}
          onKeyDown={(e) => {
            // На телефоне Enter — новая строка (несколько задач столбиком), сохранить — кнопкой со стрелкой
            // ⌘/Ctrl+Enter — отправить всегда (клавиатура у iPad)
            if (e.key === 'Enter' && ((!e.shiftKey && !touch) || e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              commit()
            }
          }}
        />
        <button class="circle-btn" style={{ marginBottom: 3 }} onClick={commit} disabled={!trimmed || (kind === 'task' && !analysis?.tasks.length)} aria-label="Сохранить"><ArrowUp size={18} /></button>
      </div>
      {analysis && (
        <div class="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Segments value={kind} onChange={(k) => setKindOverride(k)} options={[{ value: 'task', title: 'Задача' }, { value: 'note', title: 'Заметка' }]} />
          {kind === 'task' ? (
            analysis.tasks.map((t, i) => {
              const area = areaOverride ? store.areas().find((a) => a.id === areaOverride) ?? t.area : t.area
              const c = areaColor(area)
              return (
                <div key={i} class="task">
                  <Check size={16} color="var(--secondary)" />
                  {t.priority !== Priority.Normal && <span class="prio" style={{ color: priorityColor[t.priority] }}>{t.priority === Priority.Urgent ? '!!!' : '!!'}</span>}
                  <span class="pill" style={{ color: c, background: tint(c, 0.16) }}>{t.title}</span>
                  {t.dueDate && <span class="due" style={{ color: describeDue(t.dueDate, false, t.dueTime).color }}>{describeDue(t.dueDate, false, t.dueTime).text}</span>}
                </div>
              )
            })
          ) : (
            <div class="hint">Сохраню как заметку</div>
          )}
          {kind === 'task' && suggestion && !areaOverride && (
            <button class="chip" style={{ alignSelf: 'flex-start', color: palette[suggestion.colorIndex], background: tint(palette[suggestion.colorIndex], 0.16) }}
              onClick={() => setAreaOverride(store.addAreaFromTemplate(suggestion).id)}>
              <Plus size={11} /> Похоже на «{suggestion.title}» — создать раздел
            </button>
          )}
          {kind === 'task' && store.areas().length > 0 && (
            <div class="row wrap">
              {store.areas().map((a) => {
                const c = areaColor(a)
                const on = (areaOverride ?? analysis.tasks[0]?.area.id) === a.id
                return (
                  <button key={a.id} class="chip" style={{ color: on ? '#fff' : c, background: on ? c : tint(c, 0.14) }} onClick={() => setAreaOverride(a.id)}>
                    <AreaIcon name={a.icon} size={11} /> {a.title}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
