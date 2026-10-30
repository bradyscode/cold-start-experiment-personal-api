# personal-web

The web app for the Personal API: a swipe feed, chart pages, dashboards, an entry form and settings. It is a static site (React, TypeScript, Vite) that talks to the API. The API has no authentication in this experiment, so the web app just talks to the address in settings.

## Run it locally

Start the API from the repo root (Windows), or press run on the `http` profile in Visual Studio:

```
dotnet run --project personal-api
```

In Development the API does not redirect HTTP to HTTPS, so the dev web app can call `http://localhost:5047` directly (a redirect would break the CORS preflight). The `http` profile listens on `http://localhost:5047`; the `https` profile also serves `https://localhost:7236`. `VITE_API_BASE_URL` (see `.env.example`) must match the profile you run.

Then, in `personal-web/`:

```
npm install
npm run dev
```

Open `http://localhost:5173`.

## Settings

| Where | Setting | What it does |
| --- | --- | --- |
| Web | `VITE_API_BASE_URL` | Where the API lives. Default `http://localhost:5047`. Set it in `.env.local` (see `.env.example`); `.env.local` is gitignored, so it stays on your machine. It is baked in at build time. |
| API | `Cors__AllowedOrigins__0` | Origin of the web app. `appsettings.json` has no allowed origins; `appsettings.Development.json` lists `http://localhost:5173`, so in Development nothing needs setting. In any other environment, or for any other origin (a phone using a LAN IP, a deployed static site), set it to the exact origin with no trailing slash, for example `Cors__AllowedOrigins__0=https://app.example.com`. Use `__1`, `__2`, ... for more origins. |

## Dev database reset

There are no database migrations. When the kinds schema changes (for example a new column), delete `data/personal-api.db` (in the `data/` folder under the API's working directory: `personal-api/data/` when started with `dotnet run --project personal-api` or Visual Studio, or `<that directory>/data/` with `--no-launch-profile`) before running the API. It is recreated on start and the default kinds are seeded again.

## Install on a phone

Browsers only allow service workers (and so installing) on HTTPS, with `localhost` as the one exception. So a phone on your network cannot install the app from `http://192.168.x.x:5173`. To install on a phone, host both the built site and the API on HTTPS, set `VITE_API_BASE_URL` to the API's HTTPS address, add the site's origin to `Cors__AllowedOrigins__0`, then use "Add to Home Screen" (Android and iOS) or "Install app" in the browser menu.

The service worker saves only the app shell (scripts, styles, fonts, icons). It never caches API requests, so data is always fetched live and the app needs a connection to show anything.

## Commands

```
npm test              # unit tests
npm run lint          # type check (tsc --noEmit)
npm run build         # type check, then production build into dist/
npm run verify:build  # checks dist/ has a manifest and a service worker that never caches the API
```

`node scripts/make-icons.mjs` regenerates the icons in `public/icons/`.

## What each screen does

- Feed (`#/`): swipe through cards for things worth noticing, such as a personal best or a streak. Tap a card for its chart. "Skip to dashboards" jumps ahead.
- Dashboards (`#/dashboards`): an admin-style overview of every tracker. Pick a range (7D, 30D, 90D, 1Y; remembered on this device) and filter by category chips or by single trackers. It shows a key-number card per tracker (period value, change against the previous period, sparkline, last entry), entries over time stacked by category, share of entries, an activity calendar, auto-generated insights, this period against the previous one, records and streaks, and a sortable table of all trackers. Everything comes from one `GET /analytics/overview` call plus one `GET /analytics/compare` call for the correlation insight.
- Compare (`#/compare`): pick 2 to 8 trackers and see them on one time axis (raw, indexed to 100, or z-scores), a correlation matrix (Pearson r per pair; a dash when there is not enough data, with the reason), and a pair detail: scatter plot with a fitted line, r, r squared, n, slope, and a lag control from -7 to +7 days or weeks with the best lag in words. Every setting lives in the link (`kinds`, `range`, `bucket`, `norm`, `lag`, `pair`), so a view can be bookmarked.
- Chart (`#/chart/:kind`): one tracker over time with range, day or week buckets and the aggregation (total, average, highest, entries). Totals and counts draw as bars, averages and highs as a line. Stats say what they cover: the latest bucket by date, the average over buckets that have data, and the total with the per-bucket average including empty buckets.
- Add (`#/add`): pick a tracker and log a record.
- Settings (`#/settings`): the API address.

Any other address shows a "Page not found" screen with links back.

Colors: each category has one fixed color (Health, Fitness, Code, Hobbies, Reading and media, Money, Life, and gray for anything else), checked for contrast on the card background and for color-blind separation. On the compare screen, series take colors in the order you picked them. Charts never rely on color alone: every chart has a legend or labels, values on hover and keyboard focus, and a "Show data table" option.
