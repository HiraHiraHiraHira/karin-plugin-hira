import { defineConfig } from 'vitest/config'

const root = new URL('.', import.meta.url).pathname

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      'node-karin/root': `${root}node_modules/node-karin/dist/root.mjs`,
      'node-karin': `${root}node_modules/node-karin/dist/index.mjs`
    }
  }
})
