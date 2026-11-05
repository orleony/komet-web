import { useRef, useState } from 'preact/hooks'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Pencil, Plus, Settings, Trash2, Upload } from 'lucide-preact'
import type { Area } from '../model'
import { addDays, dayHeader, relativeDay, startOfToday, toDate, startOfWeek } from '../lib/dates'
import { parse } from '../lib/keywords'
import { router, templateOf } from '../lib/router'
import * as store from '../store'
import { AreaIcon, areaIcons } from '../ui/icons'
import { Screen, Segments, Sheet, useSheet, Toggle, areaColor, palette, showToast, tint } from '../ui/controls'
import { TaskRow } from '../ui/tasks'
import { ClassRow } from './schedule'
import { NotificationsCard } from '../push'

type Page = 'week' | 'trash' | 'settings' | null

export function More() {
  const [page, setPage] = useState<Page>(null)
  if (page) {
    return (
      <div>
        <div style={{ padding: 'calc(var(--safe-top) + 8px) 16px 0' }}>
          <button class="back" onClick={() => setPage(null)}><ChevronLeft size={18} /> Назад</button>
        </div>
        {page === 'week' && <Week />}
        {page === 'trash' && <TrashPage />}
        {page === 'settings' && <SettingsPage />}
      </div>
    )
  }
  const trash = store.trashCount()
  return (
    <Screen title="Ещё">
      <div class="section">
        <Link icon={<CalendarDays size={16} />} title="Неделя" onClick={() => setPage('week')} />
        <Link icon={<Trash2 size={16} />} title="Корзина" detail={trash ? String(trash) : undefined} onClick={() => setPage('trash')} />
        <Link icon={<Settings size={16} />} title="Настройки" onClick={() => setPage('settings')} />
      </div>
      <InstallHint />
    </Screen>
  )
}

function Link(props: { icon: preact.ComponentChildren; title: string; detail?: string; onClick: () => void }) {
  return (
    <button class="link-row" onClick={props.onClick}>
      <span class="ic">{props.icon}</span>
      <b class="grow" style={{ fontSize: 15 }}>{props.title}</b>
      {props.detail && <span class="hint" style={{ fontSize: 13 }}>{props.detail}</span>}
      <ChevronRight size={16} color="var(--secondary)" />
    </button>
  )
}

/** Подсказка, как поставить на экран «Домой», — пока Komet открыт просто в Safari. */
function InstallHint() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
  if (standalone) return null
  return (
    <div class="card">
      <div class="toggle-title" style={{ marginBottom: 6 }}>Поставь Komet на экран «Домой»</div>
      <div class="hint" style={{ fontSize: 13, lineHeight: 1.45 }}>
        В Safari нажми «Поделиться» <b>⎋</b> → «На экран „Домой“». Так Komet откроется как приложение, сможет присылать
        напоминания, а данные не сотрутся, даже если долго не заходить.
      </div>
    </div>
  )
}

// MARK: - Неделя

function Week() {
  const today = startOfToday()
  const days = [...Array(7)].map((_, i) => addDays(startOfWeek(today), i))
  const plan = store.plan()
  return (
    <Screen title="Неделя">
      {days.map((d) => {
        const slots = store.classesOn(d)
        const tasks = plan.filter((t) => toDate(t.dueDate)!.toDateString() === d.toDateString())
        const isToday = d.toDateString() === today.toDateString()
        return (
          <div key={d.toISOString()} class="section" style={{ opacity: d < today ? 0.5 : 1 }}>
            <div class="section-head" style={isToday ? { color: 'var(--accent)' } : undefined}>{dayHeader(d)}{isToday && ' · сегодня'}</div>
            {!slots.length && !tasks.length && <div class="hint">Свободно</div>}
            {slots.map((s) => <ClassRow key={s.id} slot={s} now={isToday ? store.clock.value : undefined} />)}
            {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
        )
      })}
    </Screen>
  )
}

// MARK: - Корзина

function TrashPage() {
  const tasks = store.trash()
  const notes = store.noteTrash()
  const days = store.prefs.value.trashDays
  return (
    <Screen title="Корзина" subtitle={days ? `Удаляется насовсем через ${days === 7 ? 'неделю' : 'месяц'}` : 'Очищается вручную'}
      right={tasks.length + notes.length > 0 ? <button class="btn danger" onClick={() => confirm('Удалить всё из корзины насовсем?') && store.emptyTrash()}>Очистить</button> : undefined}>
      {!tasks.length && !notes.length && <div class="empty">Корзина пуста</div>}
      {tasks.length > 0 && (
        <div class="section">
          <div class="section-head">Задачи <span class="count">{tasks.length}</span></div>
          {tasks.map((t) => (
            <div key={t.id} class="row">
              <span class="pill done grow" style={{ textDecoration: t.isDone ? 'line-through' : 'none' }}>{t.title}</span>
              <button class="btn-text" onClick={() => store.restoreTask(t)}>Вернуть</button>
              <button class="icon-btn" onClick={() => store.purgeTask(t)} aria-label="Удалить насовсем"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div class="section">
          <div class="section-head">Заметки <span class="count">{notes.length}</span></div>
          {notes.map((n) => (
            <div key={n.id} class="row">
              <div class="grow" style={{ minWidth: 0 }}>
                <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{store.noteTitle(n)}</b>
                <span class="hint">удалена {relativeDay(toDate(n.trashedAt)!).toLowerCase()}</span>
              </div>
              <button class="btn-text" onClick={() => store.restoreNote(n)}>Вернуть</button>
              <button class="icon-btn" onClick={() => store.purgeNote(n)} aria-label="Удалить насовсем"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </Screen>
  )
}

// MARK: - Настройки

function SettingsPage() {
  const p = store.prefs.value
  const [editing, setEditing] = useState<Area | 'new' | null>(null)
  const [probe, setProbe] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const result = probe.trim() ? router.route(probe, store.studyHints()) : null

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(store.exportSnapshot())], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `komet-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }
  const importFile = async (file: File) => {
    try {
      const count = store.importSnapshot(JSON.parse(await file.text()))
      showToast(count ? `Перенесено записей: ${count}` : 'Всё уже было на месте')
    } catch {
      showToast('Не получилось прочитать файл')
    }
  }

  return (
    <Screen title="Настройки">
      <div class="kicker">Напоминания</div>
      <NotificationsCard />

      <div class="kicker" style={{ marginTop: 6 }}>Задачи</div>
      <div class="card section">
        <div class="row">
          <div class="toggle-title grow">Разделы</div>
          <button class="chip" style={{ color: 'var(--accent)', background: tint('#ff5a3c', 0.16) }} onClick={() => setEditing('new')}><Plus size={12} /> Раздел</button>
        </div>
        {!store.areas().length && <div class="hint">Разделов пока нет — всё попадает во «Входящие». Добавь их здесь или во вкладке «Задачи».</div>}
        {store.areas().map((a) => (
          <div key={a.id} class="row">
            <span style={{ width: 26, height: 26, borderRadius: 13, background: areaColor(a), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flex: 'none' }}>
              <AreaIcon name={a.icon} size={12} />
            </span>
            <div class="grow">
              <b style={{ fontSize: 14 }}>{a.title}</b>
              <div class="hint">{store.fallbackArea().id === a.id ? 'сюда — всё неузнанное' : templateOf(a) ? 'знает, что сюда класть' : `${parse(a.keywords).length} слов`}</div>
            </div>
            <button class="icon-btn" onClick={() => store.moveArea(a, -1)} aria-label="Выше"><ChevronUp size={16} /></button>
            <button class="icon-btn" onClick={() => store.moveArea(a, 1)} aria-label="Ниже"><ChevronDown size={16} /></button>
            <button class="icon-btn" onClick={() => setEditing(a)} aria-label="Изменить"><Pencil size={15} /></button>
          </div>
        ))}
        <Toggle on={p.mlEnabled} onChange={(v) => store.setPref('mlEnabled', v)} title="Умное распределение"
          subtitle={router.trainedExamples ? `Учится на твоих задачах прямо на телефоне · ${router.trainedExamples} примеров` : 'Начнёт помогать, когда наберётся пара задач в двух разделах'} />
        <div class="field">
          <input placeholder="Проверь фразу: «сходить на тренировку»" value={probe} onInput={(e) => setProbe(e.currentTarget.value)} />
          {result && <span class="chip" style={{ color: areaColor(result.area), background: tint(areaColor(result.area), 0.16) }}>→ {result.area.title}</span>}
        </div>
      </div>

      <div class="card section">
        <div class="toggle-title">Выполненные уходят в корзину</div>
        <Segments value={p.cleanup} onChange={(v) => store.setPref('cleanup', v)} options={[{ value: 'weekly', title: 'Раз в неделю' }, { value: 'daily', title: 'Каждый день' }, { value: 'never', title: 'Никогда' }]} />
        <div class="label" style={{ margin: 0 }}>Корзина очищается</div>
        <Segments value={p.trashDays} onChange={(v) => store.setPref('trashDays', v)} options={[{ value: 7, title: 'Через неделю' }, { value: 30, title: 'Через месяц' }, { value: 0, title: 'Вручную' }]} />
      </div>

      <div class="card section">
        <Toggle on={p.showSchedule} onChange={(v) => { store.setPref('showSchedule', v); if (v) store.setPref('scheduleSetupDismissed', false) }} title="Вкладка «Пары»" subtitle="Расписание занятий; можно спрятать, если не учишься" />
      </div>

      <div class="kicker" style={{ marginTop: 6 }}>Перенос данных</div>
      <div class="card section">
        <div class="hint" style={{ fontSize: 13 }}>Все данные хранятся только на этом телефоне. Файлом можно сделать копию или перенести всё с Mac.</div>
        <div class="row wrap">
          <button class="btn secondary" onClick={exportFile}><Download size={16} /> Сохранить в файл</button>
          <button class="btn secondary" onClick={() => fileRef.current?.click()}><Upload size={16} /> Загрузить</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) importFile(f); e.currentTarget.value = '' }} />
        </div>
      </div>

      <Diagnostics />
      {editing && <AreaEditor area={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Screen>
  )
}

// MARK: - Редактор раздела

function AreaEditor({ area, onClose }: { area: Area | null; onClose: () => void }) {
  const sheet = useSheet(onClose)
  const [title, setTitle] = useState(area?.title ?? '')
  const [icon, setIcon] = useState(area?.icon ?? 'star.fill')
  const [colorIndex, setColorIndex] = useState(area?.colorIndex ?? 3)
  const [keywords, setKeywords] = useState(area?.keywords ?? '')
  const [makeFallback, setMakeFallback] = useState(false)
  const [template, setTemplate] = useState<string | null>(area?.template ?? null)
  const isFallback = area && store.fallbackArea().id === area.id

  const save = () => {
    if (!title.trim()) return
    const saved = area
      ? (store.saveArea({ ...area, title: title.trim(), icon, colorIndex, keywords, template }), area)
      : store.addArea({ title: title.trim(), icon, colorIndex, keywords, template })
    if (makeFallback) store.setFallback(saved)
    sheet.close()
  }

  return (
    <Sheet closing={sheet.closing} title={area ? 'Раздел' : 'Новый раздел'} onClose={sheet.close} action={<button class="btn primary" disabled={!title.trim()} onClick={save}>Готово</button>}>
      {!area && (
        <div>
          <div class="label">Готовые разделы</div>
          <div class="row wrap">
            {router.missingTemplates().map((t) => (
              <button key={t.id} class="chip" style={{ color: palette[t.colorIndex], background: tint(palette[t.colorIndex], template === t.id ? 0.3 : 0.14) }}
                onClick={() => { setTitle(t.title); setIcon(t.icon); setColorIndex(t.colorIndex); setKeywords(t.keywords); setTemplate(t.id) }}>
                <AreaIcon name={t.icon} size={11} /> {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="field"><input placeholder="Название" value={title} onInput={(e) => setTitle(e.currentTarget.value)} /></div>
      <div>
        <div class="label">Цвет</div>
        <div class="row wrap">
          {palette.slice(0, 8).map((c, i) => (
            <button key={c} onClick={() => setColorIndex(i)} style={{ width: 30, height: 30, borderRadius: 15, background: c, outline: i === colorIndex ? '2px solid #fff' : 'none', outlineOffset: 2 }} aria-label={`Цвет ${i + 1}`} />
          ))}
        </div>
      </div>
      <div>
        <div class="label">Значок</div>
        <div class="row wrap" style={{ gap: 6 }}>
          {areaIcons.map((n) => (
            <button key={n} onClick={() => setIcon(n)} style={{ width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: n === icon ? palette[colorIndex] : 'var(--card)', color: n === icon ? '#fff' : 'var(--secondary)' }}>
              <AreaIcon name={n} size={17} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <div class="label">Ключевые слова — через запятую</div>
        <div class="field"><textarea rows={4} value={keywords} placeholder="тренировка, зал, пробежка" onInput={(e) => setKeywords(e.currentTarget.value)} /></div>
      </div>
      {!isFallback && <Toggle on={makeFallback} onChange={setMakeFallback} title="Всё неузнанное — сюда" subtitle="Вместо «Входящих»" />}
      {isFallback && <button class="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => { store.setFallback(null); sheet.close() }}>Неузнанное — снова во «Входящие»</button>}
      {area && (
        <div class="row">
          <button class="btn danger" onClick={() => { if (confirm(`Удалить раздел «${area.title}»? Его задачи переедут во «Входящие».`)) { store.deleteArea(area); sheet.close() } }}>Удалить раздел</button>
        </div>
      )}
    </Sheet>
  )
}


/** Версия; тройное нажатие — размеры экрана для поиска багов вёрстки на iPhone. */
function Diagnostics() {
  const [taps, setTaps] = useState(0)
  const [info, setInfo] = useState<string>('')
  const collect = () => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;left:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);visibility:hidden'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const safe = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => parseFloat(v)).join(' / ')
    probe.remove()
    const r = (sel: string) => {
      const b = document.querySelector(sel)?.getBoundingClientRect()
      return b ? `${Math.round(b.top)}–${Math.round(b.bottom)}` : '—'
    }
    const vv = window.visualViewport
    setInfo([
      `версия ${__BUILD__}`,
      `standalone ${(navigator as any).standalone === true} · display ${window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'}`,
      `screen ${screen.width}×${screen.height}`,
      `inner ${window.innerWidth}×${window.innerHeight} · outer ${window.outerHeight}`,
      `client ${document.documentElement.clientHeight} · vv ${vv ? `${Math.round(vv.height)} (top ${Math.round(vv.offsetTop)})` : '—'}`,
      `safe area (верх/право/низ/лево) ${safe}`,
      `--app-h ${getComputedStyle(document.documentElement).getPropertyValue('--app-h') || '—'}`,
      `shell ${r('.shell')} · tabbar ${r('.tabbar')}`,
      `status bar ${document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')}`,
      navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''),
    ].join('\n'))
  }
  return (
    <div style={{ textAlign: 'center' }}>
      <button class="hint" onClick={() => { const n = taps + 1; setTaps(n); if (n >= 3) collect() }}>Komet · версия {__BUILD__}</button>
      {info && <pre class="card" style={{ textAlign: 'left', whiteSpace: 'pre-wrap', fontSize: 11.5, marginTop: 8, userSelect: 'text', WebkitUserSelect: 'text' }}>{info}</pre>}
    </div>
  )
}
