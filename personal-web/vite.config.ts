/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions } from './pwa.config.ts';

export default defineConfig({
  base: './',
  plugins: [react(), VitePWA(pwaOptions)],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
