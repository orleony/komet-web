import { defineConfig } from 'vitest/config'

// Эталон разбора фраз снят на Mac по московскому времени — тесты считают даты так же, где бы ни запускались
process.env.TZ = 'Europe/Moscow'

export default defineConfig({ test: {} })
