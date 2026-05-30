import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    // Listen on all interfaces so a tunnel (ngrok) can reach the dev server.
    host: true,
    // Vite 5 rejects requests whose Host header it doesn't recognise. ngrok
    // forwards its own *.ngrok-free.app / *.ngrok.app host, so allow it
    // through (along with localhost) — this is dev-only.
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.app', '.ngrok.io', 'localhost'],
    // Safe App iframe embedding requires permissive headers in dev
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
})
