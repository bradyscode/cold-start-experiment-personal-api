export type LoadedRoute = { matcher: (ctx: unknown) => unknown; handler: string | undefined; method: string | undefined };
export function loadServiceWorker(source: string): { routes: LoadedRoute[]; navigations: { denylist?: RegExp[] }[] };
export const API_SAMPLES: string[];
export const SHELL_SAMPLES: string[];
export function runMatcher(route: LoadedRoute, href: string): boolean;
