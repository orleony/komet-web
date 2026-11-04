import { render } from 'preact'
import { App } from './app'
import * as store from './store'
import { load } from './store'
import { startReminderSync } from './push'
import './styles.css'

/** Высота приложения. На iPhone с экрана «Домой» видимая область при запуске считается то меньше, то больше
 *  настоящей (нижняя панель прыгала и уезжала за край). Приложение там всегда во весь экран —
 *  поэтому берём размер самого экрана; в Safari — видимую высоту. */
function fitHeight() {
  const standalone = (navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches
  const portrait = window.innerHeight >= window.innerWidth
  const h = standalone && portrait ? Math.max(screen.height, screen.width) : window.innerHeight
  document.documentElement.style.setProperty('--app-h', `${h}px`)
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
