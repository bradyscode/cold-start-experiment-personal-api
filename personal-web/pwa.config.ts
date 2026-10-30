import type { VitePWAOptions } from 'vite-plugin-pwa';

// Matches the API route segment anywhere in the path, so it also covers an API served under a prefix or on another origin.
export const API_PATH_PATTERN = /(^|\/)(feed|series|records|kinds|health|analytics)(\/|$)/;

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  manifest: {
    name: 'Personal API',
    short_name: 'Life feed',
    description: 'A personal feed and dashboards for the things you track.',
    display: 'standalone',
    start_url: './',
    scope: './',
    theme_color: '#10141A',
    background_color: '#10141A',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [API_PATH_PATTERN],
    runtimeCaching: [
      {
        // Workbox serializes this function into sw.js, so it must not reference outside identifiers.
        urlPattern: ({ url }: { url: URL }) => /(^|\/)(feed|series|records|kinds|health|analytics)(\/|$)/.test(url.pathname),
        handler: 'NetworkOnly',
      },
    ],
  },
  devOptions: { enabled: false },
};
