// Checks the production build output (run `npm run build` first): npm run verify:build
// Fails if the manifest or service worker is missing, or if the generated matcher does not route API URLs to NetworkOnly when executed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_SAMPLES, SHELL_SAMPLES, loadServiceWorker, runMatcher } from './sw-sandbox.mjs';

const dist = join(import.meta.dirname, '..', 'dist');
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const manifestPath = join(dist, 'manifest.webmanifest');
const swPath = join(dist, 'sw.js');
check(existsSync(manifestPath), 'dist/manifest.webmanifest exists');
check(existsSync(swPath), 'dist/sw.js exists');

if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  check(m.display === 'standalone' && m.start_url === './' && m.scope === './', 'manifest is standalone with relative start_url and scope');
  check(m.icons?.length === 3 && m.icons.some((i) => i.purpose === 'maskable'), 'manifest lists 3 icons including a maskable one');
  for (const icon of m.icons ?? []) check(existsSync(join(dist, icon.src)), `icon ${icon.src} is in dist`);
}

if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  let loaded;
  try {
    loaded = loadServiceWorker(sw);
    check(true, 'sw.js evaluates in a sandbox');
  } catch (e) {
    check(false, `sw.js failed to evaluate in a sandbox: ${e.message}`);
  }
  if (loaded) {
    const { routes, navigations } = loaded;
    check(routes.length > 0, `sw.js registers ${routes.length} runtime route(s)`);
    check(routes.every((r) => r.handler === 'NetworkOnly'), `every runtime route uses NetworkOnly (found: ${routes.map((r) => r.handler).join(', ')})`);
    for (const route of routes) {
      for (const href of API_SAMPLES) {
        let result;
        try {
          result = runMatcher(route, href);
        } catch (e) {
          result = `threw ${e.message}`;
        }
        check(result === true, `matcher returns true for API URL ${href}${result === true ? '' : ` (got ${result})`}`);
      }
      for (const href of SHELL_SAMPLES) {
        let result;
        try {
          result = runMatcher(route, href);
        } catch (e) {
          result = `threw ${e.message}`;
        }
        check(result === false, `matcher returns false for shell URL ${href}${result === false ? '' : ` (got ${result})`}`);
      }
    }
    const deny = navigations.flatMap((n) => n.denylist ?? []);
    for (const href of API_SAMPLES) check(deny.some((re) => re.test(new URL(href).pathname)), `navigation denylist blocks ${href}`);
    for (const href of SHELL_SAMPLES) check(!deny.some((re) => re.test(new URL(href).pathname)), `navigation denylist allows ${href}`);
  }
  const precached = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((x) => x[1]);
  check(precached.length > 0, `sw.js precaches ${precached.length} shell files`);
  check(!precached.some((u) => /(^|\/)(feed|series|records|kinds|health|analytics)(\/|$)/.test(u)), 'no API path is in the precache list');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nBuild verified.');
