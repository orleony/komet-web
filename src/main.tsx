import { render } from 'preact'
import { App } from './app'
import * as store from './store'
import { load } from './store'
import { startReminderSync } from './push'
import './styles.css'

load().then(() => {
  render(<App />, document.getElementById('app')!)
  startReminderSync()
  // Для проверок в разработке: window.__komet.importSnapshot(...)
  if (import.meta.env.DEV) (window as any).__komet = store
})

// Работа без интернета и напоминания — через service worker
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js')
}
