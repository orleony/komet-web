import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { signal } from '@preact/signals'
import { Priority } from '../model'
import type { Area } from '../model'
import { daysLeft, isoWeekday, plural, relativeDay, shortDate, weekdayShort } from '../lib/dates'

export const palette = ['#63a8ff', '#ffb340', '#4dd97a', '#bf8fff', '#ff73a6', '#4dd1d9', '#ffd64d', '#ff6b61', '#8a8a8e']
export const areaColor = (a: Area) => palette[Math.min(Math.max(a.colorIndex, 0), palette.length - 1)]
export const tint = (hex: string, alpha: number) => hex + Math.round(alpha * 255).toString(16).padStart(2, '0')
export const priorityColor: Record<Priority, string> = {
  [Priority.Normal]: 'var(--secondary)',
  [Priority.Important]: 'var(--warning)',
  [Priority.Urgent]: 'var(--danger)',
}

export function Toggle(props: { on: boolean; onChange: (v: boolean) => void; title: string; subtitle?: string }) {
  return (
    <button class={'toggle' + (props.on ? ' on' : '')} onClick={() => props.onChange(!props.on)}>
      <div class="grow">
        <div class="toggle-title">{props.title}</div>
        {props.subtitle && <div class="hint">{props.subtitle}</div>}
      </div>
      <div class="knob" />
    </button>
  )
}

export function Segments<T extends string | number>(props: { value: T; options: { value: T; title: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="segments">
      {props.options.map((o) => (
        <button key={String(o.value)} class={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.title}
        </button>
      ))}
    </div>
  )
}

/** Закрытие шторки с анимацией: редактор вызывает sheet.close() вместо onClose(). */
export function useSheet(onClose: () => void) {
  const [closing, setClosing] = useState(false)
  const timer = useRef<number>()
  const latest = useRef(onClose)
  latest.current = onClose
  // Шторку убрали раньше, чем доиграла анимация, — не дёргаем onClose у уже исчезнувшего экрана
  useEffect(() => () => clearTimeout(timer.current), [])
  const close = () => {
    if (closing) return
    setClosing(true)
    timer.current = window.setTimeout(() => latest.current(), 220)
  }
  return { closing, close }
}

/** Шторка снизу — вместо системных окон. Рисуется поверх всего приложения; смахивается вниз. */
export function Sheet(props: { title: string; onClose: () => void; closing?: boolean; children: ComponentChildren; action?: ComponentChildren }) {
  const own = useSheet(props.onClose)
  const controlled = props.closing !== undefined
  const closing = controlled ? props.closing! : own.closing
  const close = controlled ? props.onClose : own.close
  const sheetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    document.body.classList.add('sheet-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('sheet-open')
    }
  }, [])

  // Смахивание вниз за верх шторки
  const onTouchStart = (e: TouchEvent) => { drag.current = { y: e.touches[0].clientY, dy: 0 } }
  const onTouchMove = (e: TouchEvent) => {
    if (!drag.current || !sheetRef.current) return
    drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y)
    sheetRef.current.style.transition = 'none'
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const onTouchEnd = () => {
    const el = sheetRef.current
    const dy = drag.current?.dy ?? 0
    drag.current = null
    if (!el) return
    el.style.transition = ''
    if (dy > 90) {
      el.style.transform = 'translateY(100%)'
      close()
    } else el.style.transform = ''
  }

  return createPortal(
    <div class={'sheet-backdrop' + (closing ? ' closing' : '')} onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="sheet" ref={sheetRef}>
        <div class="sheet-drag" onTouchStart={onTouchStart as any} onTouchMove={onTouchMove as any} onTouchEnd={onTouchEnd}>
          <div class="sheet-grip" />
          <div class="sheet-head">
            <h2>{props.title}</h2>
            {props.action}
          </div>
        </div>
        {props.children}
      </div>
    </div>,
    document.body,
  )
}

/** Срок с подсветкой срочности: чем ближе дата, тем «горячее» цвет. */
export function describeDue(date: Date, isDone = false, time: number | null = null, now = new Date()): { text: string; color: string } {
  // Сегодня, но время уже вышло — просрочено
  if (!isDone && time != null && daysLeft(date, now) === 0 && time <= now.getHours() * 60 + now.getMinutes()) {
    return { text: `просрочено · ${clock(time)}`, color: 'var(--danger)' }
  }
  const d = describeDay(date, isDone)
  // Задача ко времени: «сегодня · 18:00»
  return time == null ? d : { ...d, text: `${d.text} · ${clock(time)}` }
}

const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`

function describeDay(date: Date, isDone: boolean): { text: string; color: string } {
  if (isDone) return { text: relativeDay(date), color: 'var(--secondary)' }
  const days = daysLeft(date)
  const weekday = weekdayShort[isoWeekday(date) - 1].toLowerCase()
  const n = (d: number) => `${d} ${plural(d, 'день', 'дня', 'дней')}`
  if (days < 0) return { text: `просрочено на ${n(-days)}`, color: 'var(--danger)' }
  if (days === 0) return { text: 'сегодня', color: 'var(--danger)' }
  if (days === 1) return { text: 'завтра', color: 'var(--warning)' }
  if (days <= 3) return { text: `через ${n(days)} · ${weekday}`, color: 'var(--soon)' }
  if (days <= 7) return { text: `через ${n(days)} · ${weekday}`, color: 'var(--secondary)' }
  return { text: 'до ' + shortDate(date), color: 'var(--secondary)' }
}

export function ProgressRing({ done, total, color }: { done: number; total: number; color: string }) {
  const r = 22
  const c = 2 * Math.PI * r
  const p = total ? done / total : 0
  return (
    <svg width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r={r} fill="none" stroke="var(--raised)" stroke-width="5" />
      {p > 0 && <circle cx="26" cy="26" r={r} fill="none" stroke={color} stroke-width="5" stroke-linecap="round"
        stroke-dasharray={`${c * p} ${c}`} transform="rotate(-90 26 26)" />}
      <text x="26" y="30" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">{done}/{total}</text>
    </svg>
  )
}

/** Короткое всплывающее «Сохранено» */
export const toast = signal<{ text: string; action?: string; run?: () => void } | null>(null)
let toastTimer: number | undefined
/** Короткая подсказка; с action — кнопка «Вернуть» на пару секунд дольше */
export function showToast(text: string, action?: string, run?: () => void) {
  toast.value = { text, action, run }
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), action ? 4000 : 2200)
}

export function Screen(props: { title: string; subtitle?: string; right?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="screen">
      <div class="screen-head">
        <div class="grow">
          <h1>{props.title}</h1>
          {props.subtitle && <div class="subtitle">{props.subtitle}</div>}
        </div>
        {props.right}
      </div>
      {props.children}
    </div>
  )
}
