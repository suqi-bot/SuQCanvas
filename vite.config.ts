import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/SuQCanvas/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ai-comfy': {
        target: 'http://127.0.0.1:8188',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai-comfy/, ''),
        configure: (proxy) => proxy.on('proxyReq', (request) => request.removeHeader('origin')),
      },
      '/lan-ws': {
        target: 'ws://127.0.0.1:8790',
        ws: true,
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
