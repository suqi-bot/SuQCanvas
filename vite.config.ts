import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/SuQCanvas/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/lan-ws': {
        target: 'ws://127.0.0.1:8790',
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
  },
})
