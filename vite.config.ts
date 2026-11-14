/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// Tile/style hosts whose responses are cached for offline use.
// The same cache name is filled explicitly by "Offline-Karten" (src/lib/offline.ts).
export const TILE_CACHE = 'bikepath-tiles';

// GitHub Pages serves the app from a sub-folder (/bikepath/), so assets, the service
// worker scope and the manifest all have to be prefixed. The dev server keeps '/',
// which is what `npm run dev` and the phone tests over adb reverse expect.
const base = (globalThis as any).process?.env?.BASE_PATH || '/';

export default defineConfig(({ mode }) => ({
  base,
  plugins: [
    react(),
    // `npm run dev:phone` serves over HTTPS on the LAN so GPS works on a real phone.
    ...(mode === 'phone' ? [basicSsl()] : []),
    VitePWA({
      // 'prompt': a new version waits until src/updates.ts lets it take over (not during a ride)
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'icons/icon.svg'],
      manifest: {
        name: 'Bikepath – Fahrrad Navigation',
        short_name: 'Bikepath',
        description: 'Fahrrad-Routenplaner und Navigation',
        lang: 'de',
        theme_color: '#0b6bd6',
        background_color: '#0b6bd6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}icons/icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              /tiles\.openfreemap\.org|tile\.openstreetmap\.org|tile-cyclosm|tile\.opentopomap|arcgisonline\.com|waymarkedtrails|elevation-tiles-prod/.test(
                url.hostname + url.pathname,
              ),
            handler: 'CacheFirst',
            options: {
              cacheName: TILE_CACHE,
              expiration: { maxEntries: 60000, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    include: ['tests/*.test.ts', ...((globalThis as any).process?.env?.LIVE ? ['tests/live/*.test.ts'] : [])],
  },
}));
