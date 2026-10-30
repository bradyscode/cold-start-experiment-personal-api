// Loads a generated Workbox sw.js in a node:vm sandbox with a recording workbox stub.
// Any free identifier in a serialized matcher throws a ReferenceError when the matcher runs.
import vm from 'node:vm';

export function loadServiceWorker(source) {
  const routes = [];
  const navigations = [];
  const stub = new Proxy(
    {},
    {
      get(_, name) {
        if (name === 'registerRoute') return (matcher, handler, method) => typeof matcher === 'function' && routes.push({ matcher, handler: handler?.constructor?.name, method });
        if (name === 'NavigationRoute') {
          return class NavigationRoute {
            constructor(_handler, options) {
              navigations.push(options ?? {});
            }
          };
        }
        if (typeof name !== 'string') return undefined;
        const Strategy = { [name]: class {} }[name];
        return new Proxy(function () {}, { get: (_t, p) => (p === 'prototype' ? Strategy.prototype : undefined), construct: () => new Strategy(), apply: () => undefined });
      },
    },
  );
  const sandbox = {
    URL,
    Request,
    importScripts: () => {},
    skipWaiting: () => {},
    addEventListener: () => {},
    define: (_deps, factory) => factory(stub),
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'sw.js' });
  return { routes, navigations };
}

export const API_SAMPLES = [
  'http://localhost:5047/feed?limit=20',
  'https://api.example.com/series/workout?days=7',
  'http://localhost:5173/records',
  'http://localhost:5047/kinds',
  'https://api.example.com/health',
  'https://api.example.com/analytics/overview?days=30',
  'http://localhost:5047/analytics/pair?a=sleep&b=mood',
  'https://api.example.com/v1/feed',
];

export const SHELL_SAMPLES = [
  'http://localhost:5173/',
  'http://localhost:5173/assets/index-abc.js',
  'http://localhost:5173/icons/icon-192.png',
  'http://localhost:5173/manifest.webmanifest',
];

export function runMatcher(route, href) {
  const url = new URL(href);
  return Boolean(route.matcher({ url, request: new Request(href), sameOrigin: url.origin === 'http://localhost:5173' }));
}
