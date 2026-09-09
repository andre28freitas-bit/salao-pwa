import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Salão — Agenda & Clientes',
        short_name: 'Salão',
        description: 'Agenda, clientes, retenção e stock para salão.',
        theme_color: '#151515',
        background_color: '#f7f4ef',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'pt-PT',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,ico}']
      }
    })
  ]
})
