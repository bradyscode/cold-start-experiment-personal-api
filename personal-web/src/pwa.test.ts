// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pwaOptions } from '../pwa.config';
import { API_SAMPLES, SHELL_SAMPLES, loadServiceWorker, runMatcher } from '../scripts/sw-sandbox.mjs';

const SAMPLE_API_URLS = [
  'http://localhost:5047/feed',
  'http://localhost:5047/feed?limit=20',
  'https://api.example.com/series/workout?x=1',
  'https://api.example.com/series/range_session?bucket=week&agg=sum',
  'http://localhost:5173/records',
  'https://api.example.com/records?kind=note',
  'http://localhost:5047/kinds',
  'https://api.example.com/health',
  'https://api.example.com/analytics/overview?days=30',
  'http://localhost:5047/analytics/compare?kinds=sleep,mood&days=90&bucket=day',
  'https://api.example.com/analytics/pair?a=sleep&b=mood&lagMin=-7&lagMax=7',
];

const SHELL_URLS = [
  'http://localhost:5173/',
  'http://localhost:5173/index.html',
  'http://localhost:5173/assets/index-abc123.js',
  'http://localhost:5173/icons/icon-192.png',
  'http://localhost:5173/assets/analytics-chart-abc123.js',
];

const rules = pwaOptions.workbox?.runtimeCaching ?? [];

function matches(rule: (typeof rules)[number], href: string): boolean {
  const url = new URL(href);
  const pattern = rule.urlPattern;
  const arg = { url, request: new Request(href), sameOrigin: url.origin === 'http://localhost:5173', event: {} as never };
  if (typeof pattern === 'function') return Boolean(pattern(arg));
  if (pattern instanceof RegExp) return pattern.test(href);
  return false;
}

describe('manifest', () => {
  const manifest = pwaOptions.manifest;

  it('has the expected identity and display settings', () => {
    expect(manifest).toMatchObject({
      name: 'Personal API',
      short_name: 'Life feed',
      display: 'standalone',
      start_url: './',
      scope: './',
      theme_color: '#10141A',
      background_color: '#10141A',
    });
    expect(typeof manifest === 'object' && manifest.description).toBeTruthy();
  });

  it('lists the 192, 512 and maskable 512 icons', () => {
    const icons = typeof manifest === 'object' ? manifest.icons : undefined;
    expect(icons).toEqual([
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });
});

describe('service worker options', () => {
  it('updates automatically and is off in dev', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate');
    expect(pwaOptions.devOptions?.enabled).toBe(false);
  });

  it('falls back to index.html for navigations but never for API paths', () => {
    expect(pwaOptions.workbox?.navigateFallback).toBe('index.html');
    const deny = pwaOptions.workbox?.navigateFallbackDenylist ?? [];
    for (const href of SAMPLE_API_URLS) {
      const { pathname } = new URL(href);
      expect(deny.some((re) => re.test(pathname)), href).toBe(true);
    }
    for (const href of SHELL_URLS) {
      const { pathname } = new URL(href);
      expect(deny.some((re) => re.test(pathname)), href).toBe(false);
    }
  });

  it('routes every API URL to a NetworkOnly rule and to no other strategy', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const href of SAMPLE_API_URLS) {
      const hits = rules.filter((r) => matches(r, href));
      expect(hits.length, href).toBeGreaterThan(0);
      for (const hit of hits) expect(hit.handler, href).toBe('NetworkOnly');
    }
  });

  it('does not route app shell URLs through the API rule', () => {
    for (const href of SHELL_URLS) {
      expect(rules.some((r) => matches(r, href)), href).toBe(false);
    }
  });

  it('uses no caching strategy other than NetworkOnly at runtime', () => {
    for (const rule of rules) expect(rule.handler).toBe('NetworkOnly');
  });
});

describe('icon files', () => {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const expected: [string, number][] = [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
  ];

  it.each(expected)('%s is a PNG of %i px square', (file, size) => {
    const path = join(process.cwd(), 'public', 'icons', file);
    expect(existsSync(path)).toBe(true);
    const buf = readFileSync(path);
    expect(buf.subarray(0, 8).equals(SIGNATURE)).toBe(true);
    expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(buf.readUInt32BE(16)).toBe(size);
    expect(buf.readUInt32BE(20)).toBe(size);
  });
});

describe('built service worker', () => {
  const swPath = join(process.cwd(), 'dist', 'sw.js');
  const built = existsSync(swPath);
  if (!built) console.warn('dist/sw.js not found: run npm run build to enable the built service worker tests');

  it.skipIf(!built)('executes its serialized matcher: true for API URLs, false for shell URLs, only NetworkOnly', () => {
    const { routes } = loadServiceWorker(readFileSync(swPath, 'utf8'));
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.handler).toBe('NetworkOnly');
      for (const href of API_SAMPLES) expect(runMatcher(route, href), href).toBe(true);
      for (const href of SHELL_SAMPLES) expect(runMatcher(route, href), href).toBe(false);
    }
  });
});
