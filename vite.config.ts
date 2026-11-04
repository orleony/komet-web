import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// base './' — чтобы работало и на GitHub Pages (адрес вида /komet-web/), и локально
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { target: 'safari16' },
})
