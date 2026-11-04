import { useEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { Bold, ChevronLeft, Italic, List, ListOrdered, ListTodo, Pin, Search, SquarePen, Strikethrough, Trash2, Underline } from 'lucide-preact'
import type { Note } from '../model'
import { plural, relativeDay, toDate } from '../lib/dates'
import * as store from '../store'
import { Screen } from '../ui/controls'

export function Notes({ openID, setOpenID }: { openID: string | null; setOpenID: (id: string | null) => void }) {
  const [query, setQuery] = useState('')
  const all = store.notes()
  const q = query.trim().toLowerCase()
  const list = q ? all.filter((n) => n.text.toLowerCase().includes(q)) : all

  return (
    <>
      <Screen title="Заметки" subtitle={all.length ? `${all.length} ${plural(all.length, 'заметка', 'заметки', 'заметок')}` : undefined}>
        <div class="row">
          <div class="field grow">
            <Search size={16} color="var(--secondary)" />
            <input placeholder="Поиск" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          </div>
          <button class="circle-btn" style={{ width: 40, height: 40 }} onClick={() => setOpenID(store.addNote().id)} aria-label="Новая заметка">
            <SquarePen size={18} />
          </button>
        </div>
        {!list.length && <div class="empty">{q ? 'Ничего не нашлось' : 'Заметок пока нет — нажми карандаш'}</div>}
        <div class="section" style={{ gap: 6 }}>
          {list.map((n) => (
            <button key={n.id} class="note-row" onClick={() => setOpenID(n.id)}>
              <b>{n.isPinned && '📌 '}{store.noteTitle(n)}</b>
              <span>{relativeDay(toDate(n.updatedAt)!)}  {store.notePreview(n)}</span>
            </button>
          ))}
        </div>
      </Screen>
      {openID && <NoteEditor id={openID} onClose={() => { store.discardIfEmpty(openID); setOpenID(null) }} />}
    </>
  )
}

// MARK: - Текст ↔ оформление

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Простой текст (например, с Mac) → оформление: строки «☐ …» становятся чек-листом. */
export function textToHtml(text: string): string {
  const out: string[] = []
  let list: string | null = null
  const close = () => {
    if (list) out.push(list === 'ol' ? '</ol>' : '</ul>')
    list = null
  }
  text.split('\n').forEach((line, i) => {
    const check = /^([☐☑])\s?(.*)$/.exec(line)
    const bullet = /^[•–]\s(.*)$/.exec(line)
    const number = /^\d{1,3}\.\s(.*)$/.exec(line)
    const want = check ? 'check' : bullet ? 'ul' : number ? 'ol' : null
    if (want !== list) {
      close()
      if (want) out.push(want === 'check' ? '<ul class="checklist">' : want === 'ol' ? '<ol>' : '<ul>')
      list = want
    }
    if (check) out.push(`<li${check[1] === '☑' ? ' data-done=""' : ''}>${escape(check[2]) || '<br>'}</li>`)
    else if (bullet) out.push(`<li>${escape(bullet[1])}</li>`)
    else if (number) out.push(`<li>${escape(number[1])}</li>`)
    else if (i === 0 && line.trim()) out.push(`<h1>${escape(line)}</h1>`)
    else out.push(`<div>${escape(line) || '<br>'}</div>`)
  })
  close()
  return out.join('')
}

/** Оформление → простой текст для заголовка, поиска и переноса на Mac (галочки — «☐ / ☑»). */
function htmlToText(root: HTMLElement): string {
  const lines: string[] = []
  const walk = (el: Element) => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!lines.length) lines.push('')
        lines[lines.length - 1] += child.textContent ?? ''
        continue
      }
      if (!(child instanceof HTMLElement)) continue
      const tag = child.tagName
      if (tag === 'BR') { lines.push(''); continue }
      if (tag === 'LI') {
        const parent = child.parentElement
        const index = parent ? Array.from(parent.children).indexOf(child) + 1 : 1
        const prefix = parent?.classList.contains('checklist') ? (child.hasAttribute('data-done') ? '☑ ' : '☐ ') : parent?.tagName === 'OL' ? `${index}. ` : '• '
        lines.push(prefix + (child.innerText ?? '').replace(/\n+$/, ''))
        continue
      }
      if (['DIV', 'P', 'H1', 'H2', 'H3', 'PRE'].includes(tag)) {
        lines.push('')
        walk(child)
        continue
      }
      if (tag === 'UL' || tag === 'OL') { walk(child); continue }
      if (!lines.length) lines.push('')
      lines[lines.length - 1] += child.innerText ?? ''
    }
  }
  walk(root)
  while (lines.length && !lines[0].trim()) lines.shift()
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// MARK: - Редактор

function NoteEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number>()
  const [state, setState] = useState<Record<string, boolean>>({})
  const [styleMenu, setStyleMenu] = useState(false)
  const note = store.note(id)

  const save = () => {
    clearTimeout(timer.current)
    const el = ref.current
    if (!el) return
    store.saveNote(id, { html: el.innerHTML, text: htmlToText(el) })
  }
  const scheduleSave = () => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(save, 400)
  }

  useEffect(() => {
    const el = ref.current!
    const n = store.note(id)
    el.innerHTML = n?.html ?? (n?.text ? textToHtml(n.text) : '')
    if (!n?.text) {
      // Новая заметка: первая строка — заголовок, как в Заметках
      if (!el.innerHTML) el.innerHTML = '<h1><br></h1>'
      el.focus()
      const range = document.createRange()
      range.setStart(el.firstChild!, 0)
      range.collapse(true)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    }
    // Панель форматирования — прямо над клавиатурой
    const vv = window.visualViewport
    const place = () => {
      if (!barRef.current || !vv) return
      barRef.current.style.transform = `translateY(${-(window.innerHeight - vv.height - vv.offsetTop)}px)`
    }
    vv?.addEventListener('resize', place)
    vv?.addEventListener('scroll', place)
    const onSelection = () => setState({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough'),
    })
    document.addEventListener('selectionchange', onSelection)
    const flush = () => document.visibilityState === 'hidden' && save()
    document.addEventListener('visibilitychange', flush)
    return () => {
      save()
      vv?.removeEventListener('resize', place)
      vv?.removeEventListener('scroll', place)
      document.removeEventListener('selectionchange', onSelection)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [id])

  const exec = (command: string, value?: string) => {
    ref.current?.focus()
    document.execCommand(command, false, value)
    scheduleSave()
  }

  const toggleChecklist = () => {
    ref.current?.focus()
    const at = () => {
      const node = window.getSelection()?.anchorNode
      return (node instanceof Element ? node : node?.parentElement)?.closest('ul') ?? null
    }
    const ul = at()
    if (ul?.classList.contains('checklist')) {
      document.execCommand('insertUnorderedList') // снять список
    } else if (ul) {
      ul.classList.add('checklist') // обычный список → чек-лист
    } else {
      document.execCommand('insertUnorderedList')
      at()?.classList.add('checklist')
    }
    scheduleSave()
  }

  /** Нажатие на кружок чек-листа — отметить пункт. */
  const onClick = (e: MouseEvent) => {
    const li = (e.target as Element).closest?.('ul.checklist > li') as HTMLElement | null
    if (!li) return
    const x = e.clientX - li.getBoundingClientRect().left
    if (x > 30) return
    e.preventDefault()
    li.toggleAttribute('data-done')
    save()
  }

  /** Новый пункт после отмеченного — неотмеченный. */
  const onInput = (e: InputEvent) => {
    if (e.inputType === 'insertParagraph') {
      const node = window.getSelection()?.anchorNode
      const li = (node instanceof Element ? node : node?.parentElement)?.closest('li')
      if (li && !li.textContent?.trim()) li.removeAttribute('data-done')
      // После заголовка — обычный текст
      const block = (node instanceof Element ? node : node?.parentElement)?.closest('h1, h2')
      if (block && !block.textContent?.trim() && block.previousElementSibling?.matches('h1, h2')) document.execCommand('formatBlock', false, 'div')
    }
    scheduleSave()
  }

  /** Вставка — только текст, без чужих шрифтов и цветов. */
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault()
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '')
  }

  if (!note) return null
  const keep = (e: Event) => e.preventDefault() // кнопки панели не забирают фокус у текста

  return createPortal(
    <div class="editor-page">
      <div class="editor-top">
        <button class="back" onClick={onClose}><ChevronLeft size={18} /> Заметки</button>
        <div class="grow" />
        <button class="icon-btn" style={{ color: note.isPinned ? 'var(--accent)' : undefined }} onClick={() => store.setPinned(id, !note.isPinned)} aria-label="Закрепить"><Pin size={18} /></button>
        <button class="icon-btn" onClick={() => { store.deleteNote(note as Note); onClose() }} aria-label="Удалить"><Trash2 size={18} /></button>
      </div>
      <div ref={ref} class="editor" contentEditable data-placeholder="Начни писать…" onInput={onInput as any} onClick={onClick as any} onPaste={onPaste as any} onBlur={save} />
      <div ref={barRef} class="format-bar" onPointerDown={keep}>
        <button onClick={() => setStyleMenu(!styleMenu)} style={{ fontSize: 15 }}>Aa</button>
        {styleMenu && (
          <>
            <button onClick={() => { exec('formatBlock', 'h1'); setStyleMenu(false) }}>Заголовок</button>
            <button onClick={() => { exec('formatBlock', 'h2'); setStyleMenu(false) }}>Подзаголовок</button>
            <button onClick={() => { exec('formatBlock', 'div'); setStyleMenu(false) }}>Текст</button>
            <button onClick={() => { exec('formatBlock', 'pre'); setStyleMenu(false) }}>Моно</button>
          </>
        )}
        {!styleMenu && (
          <>
            <span class="sep" />
            <button class={state.bold ? 'on' : ''} onClick={() => exec('bold')}><Bold size={17} /></button>
            <button class={state.italic ? 'on' : ''} onClick={() => exec('italic')}><Italic size={17} /></button>
            <button class={state.underline ? 'on' : ''} onClick={() => exec('underline')}><Underline size={17} /></button>
            <button class={state.strikeThrough ? 'on' : ''} onClick={() => exec('strikeThrough')}><Strikethrough size={17} /></button>
            <span class="sep" />
            <button onClick={toggleChecklist}><ListTodo size={18} /></button>
            <button onClick={() => exec('insertUnorderedList')}><List size={18} /></button>
            <button onClick={() => exec('insertOrderedList')}><ListOrdered size={18} /></button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
