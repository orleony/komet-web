import { useEffect, useState } from 'preact/hooks'
import { CalendarDays, Ellipsis, ListChecks, NotebookText, Sun } from 'lucide-preact'
import * as store from './store'
import { toast } from './ui/controls'
import { Today } from './screens/today'
import { Tasks } from './screens/tasks'
import { Schedule } from './screens/schedule'
import { Notes } from './screens/notes'
import { More } from './screens/more'

type Tab = 'today' | 'tasks' | 'schedule' | 'notes' | 'more'

const tabs: { id: Tab; title: string; Icon: typeof Sun }[] = [
  { id: 'today', title: 'Сегодня', Icon: Sun },
  { id: 'tasks', title: 'Задачи', Icon: ListChecks },
  { id: 'schedule', title: 'Пары', Icon: CalendarDays },
  { id: 'notes', title: 'Заметки', Icon: NotebookText },
  { id: 'more', title: 'Ещё', Icon: Ellipsis },
]

export function App() {
  const [tab, setTab] = useState<Tab>((location.hash.slice(1) as Tab) || 'today')
  const [noteID, setNoteID] = useState<string | null>(null)
  const urgent = store.urgentCount()

  useEffect(() => {
    history.replaceState(null, '', '#' + tab)
    document.querySelector('.content')?.scrollTo(0, 0)
  }, [tab])

  // Счётчик горящих задач на иконке приложения
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (urgent) nav.setAppBadge?.(urgent).catch(() => {})
    else nav.clearAppBadge?.().catch(() => {})
  }, [urgent])

  if (!store.loaded.value) return null
  return (
    <div class="shell">
      <div class="content" key={tab}>
        {tab === 'today' && <Today />}
        {tab === 'tasks' && <Tasks />}
        {tab === 'schedule' && <Schedule />}
        {tab === 'notes' && <Notes openID={noteID} setOpenID={setNoteID} />}
        {tab === 'more' && <More />}
      </div>
      <nav class="tabbar">
        {tabs.filter((t) => t.id !== 'schedule' || store.prefs.value.showSchedule).map(({ id, title, Icon }) => (
          <button key={id} class={'tab' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>
            <Icon size={21} strokeWidth={2.2} />
            {title}
            {id === 'today' && urgent > 0 && <span class="badge">{urgent}</span>}
          </button>
        ))}
      </nav>
      {toast.value && <div class="toast">{toast.value}</div>}
    </div>
  )
}
