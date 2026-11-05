import { useEffect, useRef, useState } from 'preact/hooks'
import { ChevronDown, ChevronRight, Plus } from 'lucide-preact'
import * as store from '../store'
import { AreaIcon } from '../ui/icons'
import { ProgressRing, areaColor, palette, tint } from '../ui/controls'
import { AddTaskBar, TaskList, TaskRow } from '../ui/tasks'
import { parse } from '../lib/keywords'
import { router } from '../lib/router'
import type { AreaTemplate } from '../lib/templates'

/** Задачи по разделам: разделы переключаются чипами сверху; без раздела — «Входящие». */
export function Tasks() {
  const all = store.areas()
  const [areaID, setAreaID] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [doneLimit, setDoneLimit] = useState(50)
  const chipsRef = useRef<HTMLDivElement>(null)
  const inboxCount = store.openTasks(store.inbox.id).length
  const showInbox = !all.length || inboxCount > 0 || areaID === store.inbox.id
  const area = all.find((a) => a.id === areaID) ?? (areaID === store.inbox.id || !all.length ? store.inbox : all[0])
  const isInbox = area.id === store.inbox.id
  const color = areaColor(area)
  const open = store.openTasks(area.id)
  const done = store.doneTasks(area.id)
  const keywords = parse(area.keywords)
  const isFallback = store.fallbackArea().id === area.id

  // Выбранный раздел — в видимой части ряда чипов. Только при смене раздела и только по горизонтали:
  // иначе любое изменение задач прокручивало бы весь список наверх
  useEffect(() => {
    const row = chipsRef.current
    const el = row?.querySelector<HTMLElement>('[data-on]')
    if (!row || !el) return
    if (el.offsetLeft < row.scrollLeft || el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: el.offsetLeft - 18, behavior: 'smooth' })
  }, [area.id])

  const chip = (id: string, title: string, icon: string, c: string, count: number) => {
    const on = id === area.id
    return (
      <button key={id} class="chip" style={{ flex: 'none', height: 32, padding: '0 12px', fontSize: 13, color: on ? '#fff' : 'var(--secondary)', background: on ? tint(c, 0.85) : 'var(--card)' }}
        data-on={on ? '' : undefined}
        onClick={() => { setAreaID(id); setShowDone(false); setDoneLimit(50) }}>
        <AreaIcon name={icon} size={12} /> {title} {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
      </button>
    )
  }

  return (
    <div>
      <div ref={chipsRef} class="row chips-row" style={{ overflowX: 'auto', padding: 'calc(var(--safe-top) + 10px) 18px 2px', gap: 8 }}>
        {showInbox && chip(store.inbox.id, store.inbox.title, store.inbox.icon, palette[8], inboxCount)}
        {all.map((a) => chip(a.id, a.title, a.icon, areaColor(a), store.openTasks(a.id).length))}
      </div>
      <div class="screen" style={{ paddingTop: 12 }}>
        <div class="screen-head">
          <div class="grow">
            <h1>{area.title}</h1>
            <div class="subtitle">
              {isInbox ? 'Всё, что пока не разложено по разделам' : keywords.length ? keywords.slice(0, 5).join(', ') : isFallback ? 'Всё, что не подошло в другие разделы' : 'Задачи сюда — вручную или по словам раздела'}
            </div>
          </div>
          {!isInbox && <ProgressRing done={done.length} total={done.length + open.length} color={color} />}
        </div>
        {isInbox && <TemplatePicker onAdd={(id) => setAreaID(id)} />}
        <AddTaskBar areaID={area.id} />
        {!open.length && <div class="empty">{isInbox ? 'Здесь пусто — всё разложено' : 'Открытых задач нет'}</div>}
        {store.buckets(open).map((g) => <TaskList key={g.title} title={g.title} tasks={g.items} />)}
        {done.length > 0 && (
          <div class="section">
            <button class="section-head" onClick={() => setShowDone(!showDone)}>
              {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Выполнено <span class="count">{done.length}</span>
            </button>
            {showDone && done.slice(0, doneLimit).map((t) => <TaskRow key={t.id} task={t} />)}
            {showDone && done.length > doneLimit && <button class="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => setDoneLimit(doneLimit + 100)}>Показать ещё {Math.min(100, done.length - doneLimit)}</button>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Готовые разделы в один тап: Komet уже знает, что в них класть. */
function TemplatePicker({ onAdd }: { onAdd: (id: string) => void }) {
  const missing = router.missingTemplates()
  if (!missing.length) return null
  const add = (t: AreaTemplate) => {
    const area = store.addAreaFromTemplate(t)
    // Задачи из «Входящих», которые подходят новому разделу, сразу переезжают туда
    for (const task of store.openTasks(store.inbox.id)) {
      if (router.route(task.title, store.studyHints()).area.id === area.id) store.saveTask({ ...task, areaID: area.id })
    }
    onAdd(area.id)
  }
  return (
    <div class="card section">
      <div>
        <div class="toggle-title">{store.areas().length ? 'Добавить раздел' : 'Добавь свои разделы'}</div>
        <div class="hint" style={{ fontSize: 12.5, marginTop: 2 }}>Komet уже знает, что в них класть, — задачи разложатся сами</div>
      </div>
      <div class="row wrap">
        {missing.map((t) => (
          <button key={t.id} class="chip" style={{ color: palette[t.colorIndex], background: tint(palette[t.colorIndex], 0.14) }} onClick={() => add(t)}>
            <Plus size={11} /> <AreaIcon name={t.icon} size={11} /> {t.title}
          </button>
        ))}
      </div>
    </div>
  )
}
