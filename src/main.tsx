import { render } from 'preact'
import { App } from './app'
import * as store from './store'
import { load } from './store'
import { startReminderSync } from './push'
import './styles.css'

/** Высота приложения — ровно та область, где iOS его рисует; меняется — подстраиваемся. */
function fitHeight() {
  document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`)
}
fitHeight()
window.addEventListener('resize', fitHeight)
window.addEventListener('orientationchange', () => setTimeout(fitHeight, 300))
document.addEventListener('visibilitychange', fitHeight)

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
