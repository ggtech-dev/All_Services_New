import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// /api calls are proxied to the Node server so the browser sees a single origin.
// The app installs on phones and laptops (PWA). Only the app itself, fonts and public photos are cached on the device;
// orders, prices, logins and private photos (/api) always come live from the server.
// This folder is the Super Admin (HQ) app of All Services (npm run build → dist/). The other apps live in their own folders.
const APPS = {
  all: { name: 'All Services', short: 'All Services', start: '/', theme: '#4f46e5', desc: 'Fresh vegetables, milk, meat, kirana, plumbers, electricians and more — from trusted local partners.' },
  customer: { name: 'All Services', short: 'All Services', start: '/', theme: '#4f46e5', desc: 'Fresh vegetables, milk, meat, kirana, plumbers, electricians and more — from trusted local partners.' },
  agent: { name: 'All Services Partner', short: 'AS Partner', start: '/agent', theme: '#0f766e', desc: 'Delivery partners and experts: go online, take orders near you, track your earnings.' },
  admin: { name: 'All Services Franchise Admin', short: 'AS Admin', start: '/admin', theme: '#0f172a', desc: 'Run your city: orders, agents, areas and reports.' },
  super: { name: 'All Services HQ', short: 'AS HQ', start: '/super', theme: '#1e1b4b', desc: 'Super Admin: every franchise, the master catalog and platform reports.' },
};

export default defineConfig(({ mode }) => {
  const app = 'super'; // this copy is the Super Admin (HQ) app
  const meta = APPS[app];
  return {
  define: { 'import.meta.env.VITE_APP': JSON.stringify(app) },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [
    react(),
    // each app's own name in the browser tab / home-screen title, and its colour
    {
      name: 'app-html',
      transformIndexHtml: (html) => (app === 'all' || app === 'customer' ? html : html
        .replace(/<title>[^<]*<\/title>/, `<title>${meta.name}</title>`)
        .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*"/, `$1${meta.short}"`)
        .replace(/(<meta name="theme-color" content=")[^"]*"/, `$1${meta.theme}"`)),
    },
    VitePWA({
      registerType: 'autoUpdate', // a new version is picked up on the next visit, no "update" button needed
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'icons/favicon-48.png'],
      manifest: {
        id: '/',
        name: meta.name,
        short_name: meta.short,
        description: meta.desc,
        lang: 'en-IN',
        start_url: meta.start,
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: meta.theme,
        background_color: '#f5f7fb',
        categories: ['shopping', 'food', 'lifestyle'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: app === 'agent' || app === 'admin' || app === 'super' ? [] : [
          { name: 'Fresh vegetables', url: '/service/food-daily-fresh-vegetables', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'My orders', url: '/orders', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // the app is a single page: any page opens index.html — but never for API calls or uploaded files
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        importScripts: ['/push-sw.js'], // phone notifications (new orders, order updates)
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          // live data is never cached
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
          // fonts
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 3600 } },
          },
          // public photos (products, services, promotions): fast and fine to keep for a while
          {
            urlPattern: ({ url, request }) => request.destination === 'image'
              && (url.pathname.startsWith('/uploads/') || /wikimedia\.org|staticflickr\.com|openverse/.test(url.hostname)),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } },
          },
          // map tiles (live tracking): short cache
          {
            urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 400, maxAgeSeconds: 7 * 24 * 3600 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5176,
    proxy: { '/api': 'http://localhost:5000', '/uploads': 'http://localhost:5000' },
    // the build output is rewritten by `npm run build` while the dev server runs: don't watch it (Windows EBUSY crash)
    watch: { ignored: ['**/dist/**', '**/dist-apps/**'] },
  },
  };
});
