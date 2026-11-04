import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { execSync } from 'node:child_process'

const build = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

// base './' — чтобы работало и на GitHub Pages (адрес вида /komet-web/), и локально
export default defineConfig({
  base: './',
  plugins: [preact()],
  define: { __BUILD__: JSON.stringify(build) },
  build: { target: 'safari16' },
})
