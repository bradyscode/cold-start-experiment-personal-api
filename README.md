# Personal API

**This repo is primarily an experiment in cold starts.**

The first request to a freshly started API is always the slowest: the runtime compiles code on demand, Entity Framework builds its model, the first database connection opens, and the first answer has to be computed. This project is a small, real .NET API used to measure that cost endpoint by endpoint, and to test which fixes actually help.

The app itself is a "track everything" personal API (workouts, sleep, commits, reading and more) with a web app that shows the records as a swipe feed, charts and dashboards. It exists to give the experiment realistic endpoints, from a trivial health check up to a dashboard that crunches 61 trackers in one request.

> **Grain of salt:** everything here was measured on one machine, with a local API and a local SQLite database. There is no network and no separate database server. Use the numbers to compare one build against another, not to size a production system.

## What the experiment found

Median of 5 fresh starts per cell, first request to each endpoint, in milliseconds:

| Endpoint | Plain build | With the fixes | Faster by |
| --- | --- | --- | --- |
| `GET /analytics/overview?days=365` | 208.8 | 37.0 | 5.6x |
| `GET /analytics/overview?days=30` | 153.5 | 30.8 | 5.0x |
| `GET /feed` | 92.4 | 23.0 | 4.0x |
| `GET /analytics/compare?...` | 68.2 | 38.5 | 1.8x |
| `GET /health` | 4.7 | 4.7 | no change |

What I tried, and what it was worth:

- **Pre-warm (in-process):** run the common reads once before the server starts listening. Warms code paths and builds the EF model. Helped everything it touched.
- **ReadyToRun (ahead-of-time compilation):** ship pre-compiled code. About 13 to 20% off the first request and half the start-up time. (Native AOT is not an option here: EF Core and MVC controllers rely on reflection.)
- **Eager caching:** an in-memory response cache, filled at start-up and refreshed before it expires and after writes. This did most of the work on the heavy endpoints, because the first request becomes a memory read.
- **Connection pooling:** `DbContext` pooling plus pre-opened SQLite connections. Pre-opening connections made no measurable difference with SQLite; `DbContext` pooling was not isolated.
- **The price:** the server answers `/health` about 1.07 s after launch with the fixes, the same as the plain build. ReadyToRun on its own could be ready in 0.56 s.
- **Steady state:** without the response cache, the cold-start fixes leave warm throughput unchanged. All of the large warm-throughput gains come from the response cache, which serves answers that can be up to 30 seconds old.

How to run each variant, the settings, and what each fix does are in [docs/seeding-and-load-testing.md](docs/seeding-and-load-testing.md). The numbers above come from a fresh process per endpoint, 5 repetitions per variant, 6 variants, and 15.9 million requests with 0 failures in the final batch.

## Repo layout

| Path | What it is |
| --- | --- |
| `personal-api/` | The .NET 8 API (ASP.NET Core, EF Core, SQLite). Cold-start work lives in `Caching/` and `Warmup/`. |
| `personal-api.Tests/` | xUnit tests for the API. |
| `personal-web/` | The React web app (TypeScript, Vite, installable PWA). See [personal-web/README.md](personal-web/README.md). |
| `tools/loadtest/` | `run-oha.ps1` runs the load tests with [oha](https://github.com/hatoo/oha); `make_report.py` turns the results into an HTML report. |
| `tools/seed/` | `generate_seed_sql.py` generates and loads demo data. |
| `docs/` | [Seeding and load testing](docs/seeding-and-load-testing.md), the cache, and cold-start tuning. |

## Run it

You need the .NET 8 SDK and Node.js. From the repo root:

```
dotnet run --project personal-api
```

Then, in `personal-web/`:

```
npm install
npm run dev
```

Open `http://localhost:5173`. There is no sign-in: the API has no authentication in this experiment (see [Security notes](#security-notes)). [personal-web/README.md](personal-web/README.md) has the details: settings, installing on a phone.

## Reproduce the cold-start experiment

You also need [oha](https://github.com/hatoo/oha) (`winget install hatoo.oha`) and Python 3. The load-test script is PowerShell and runs on Windows.

```
python tools/seed/generate_seed_sql.py --apply     # 7,183 demo records, 61 trackers
```

One cold run (a brand new API process for every endpoint, no warm-up, first request recorded):

```
.\tools\loadtest\run-oha.ps1 -Cold -Levels 1 -Duration 1s -NoReadyToRun -NoWarmup
```

The variants are switches on the same command:

| Variant | Switches |
| --- | --- |
| Plain build, no warm-up | `-NoReadyToRun -NoWarmup` |
| ReadyToRun only | `-NoWarmup` |
| Warm-up only | `-NoReadyToRun` |
| Warm-up, cache off | `-NoReadyToRun -NoCache` |
| Everything | *(none)* |

Leave off `-Cold` for a warm steady-state run, and off `-NoReport` for an HTML report with the charts. The script always works on a copy of the database and never touches your real one.

### The settings behind the fixes

```json
"Cache":  { "Enabled": true, "TtlSeconds": 30, "MaxEntries": 512 },
"Warmup": { "Enabled": true, "RefreshAhead": true, "Connections": 8, "OverviewDays": "7,30,90,365" }
```

`Cache:Enabled=false` registers no cache at all, which is the baseline. `GET /cache/stats` shows hits and misses.

## Tests

```
dotnet test personal-api.sln
```

and, in `personal-web/`, `npm test`.

## Security notes

This is an experiment, so the API has **no authentication**. Anyone who can reach it can read and write all of the data in it.

- Locally it is safe by default: it listens on localhost only (the launch profile and ASP.NET Core's Production default are both loopback).
- If you host it on another machine, you are making an open read and write API public. Anyone who can reach it can read everything, add records, and overwrite tracker definitions. Keep it on a private network, or put it behind something that adds access control (a reverse proxy with basic auth, a VPN), or treat the data as public and disposable.
- When hosting, set `AllowedHosts` to your real hostname (for example `AllowedHosts=api.example.com`) and `Cors__AllowedOrigins__0` to your web app's origin. The repo ships `AllowedHosts: "*"` so it works anywhere, which also means a web page you visit could use DNS rebinding to reach a copy running on localhost; narrow it to `localhost` if that matters to you.
- No keys, tokens or secrets are in the repo. The database and seed file live in `data/` (git-ignored); keep demo data only in it.
- CORS only lists the web app's origin(s) (`Cors:AllowedOrigins`); it is not a substitute for authentication.
- The response cache can show data up to 30 seconds old, and does not see writes made to the database behind the API's back (for example `seed.sql`).
- Swagger is on in Development only.

## Known limits

- A tracker with more than 20,000 records cannot be charted or turned into a feed card yet; that needs database-side aggregation.
- There are no database migrations. After a schema change, delete `data/personal-api.db` and let it be recreated.

## License

No license has been chosen yet. Until one is added, all rights are reserved.
