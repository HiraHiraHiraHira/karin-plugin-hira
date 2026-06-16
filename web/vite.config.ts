import path from 'node:path'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  base: '/hira/',
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: true,
    port: 5177,
    proxy: {
      '/api/hira': {
        target: 'http://localhost:7777',
        changeOrigin: true
      },
      '/api/v1': {
        target: 'http://localhost:7777',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '../resources/web',
    emptyOutDir: true
  }
})
