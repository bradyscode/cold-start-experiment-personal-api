# Seeding the database and load testing the API (ADMIN POWERSHELL)

Two how-tos for the .NET API in `personal-api/`: fill the database with realistic demo data, and load test it with [oha](https://github.com/hatoo/oha).

All commands run from the repository root (the folder that holds `personal-api/`, `personal-web/` and `tools/`). Examples are PowerShell.

## 1. Seeding the database

### What the seed does

`personal-api/data/seed.sql` is a plain SQL file. It does three things:

1. **Deletes rows the app cannot read.** Rows whose `Id` is not a GUID, or whose date is before 1900. An earlier seed attempt stored Unix seconds and ids like `12345-54321-00812`; the app then fails with `System.FormatException: Unrecognized Guid format` on `GET /records` and `GET /analytics/overview`.
2. **Repairs the field definitions of the 15 extra custom trackers** (`api_request`, `build`, `calories`, `cpu_usage`, `deployment`, `disk_usage`, `distance`, `error`, `focus`, `heart_rate`, `memory_usage`, `reading`, `scuba_dive`, `task`, `temperature`) when they are stored in the old unreadable form. It also gives them a category and a default aggregation. Trackers that are already fine are left alone.
3. **Inserts demo records** for all 61 trackers: 120 days of correlated data (about 7,200 rows, `Source = 'seed'`). Better sleep goes with better mood, caffeine with worse sleep, commits with Claude tokens, steps with distance, and so on, so the Compare view shows real patterns.

Dates are **relative to the day you run it** (today = the run day). Events fall between 12:00 and 23:59 UTC, so the day is the same in UTC and in US time zones. Every row has a stable `ExternalId`, so **running the file twice adds nothing the second time**.

### Run it

Generating the file does **not** load it. `python tools/seed/generate_seed_sql.py` only writes `seed.sql` and prints a reminder; the database stays empty until you apply it.

From the repo root, one command writes the file, makes a backup, and loads it:

```powershell
python tools/seed/generate_seed_sql.py --apply
```

- The backup is a consistent copy next to the database: `personal-api.db.bak-<time>`.
- Start the API once first so it has created the database and the 46 built-in trackers. If the tables are missing, the script says so and changes nothing.
- The 15 extra custom trackers are created by the seed if they do not exist, so a fresh database gets all 61.
- If it reports the database is locked, stop the API (end the Visual Studio debug session) and run it again.
- Safe to repeat: a second run adds nothing.

Prefer to run the SQL yourself? Back up `personal-api.db` first, then either:

```powershell
python -c "import sqlite3; c=sqlite3.connect('personal-api/data/personal-api.db'); c.executescript(open('personal-api/data/seed.sql',encoding='utf-8').read()); c.commit()"
sqlite3 personal-api/data/personal-api.db ".read personal-api/data/seed.sql"
```

Or open the `.db` in DB Browser for SQLite, choose Execute SQL, open `seed.sql`, run it, then Write Changes. Then refresh the app: the feed, dashboards and Compare view should be full.

### Check it worked

The end of `seed.sql` runs three read-only checks (records per tracker, trackers that are missing, unreadable rows left). Missing trackers and unreadable rows should both be zero. You can also call the API: `GET /records?limit=3` and `GET /analytics/overview?days=30` should return 200.

### Undo, redo, regenerate

- Remove the demo data: `DELETE FROM Records WHERE Source = 'seed';`
- Re-seed: run the file again (it only adds what is missing).
- Regenerate (different seed, longer history): `python tools/seed/generate_seed_sql.py --days 180 --seed 7 --apply` (without `--apply` it only writes `personal-api/data/seed.sql`; use `--out` for another path and `--db` for another database). Standard library only.
- `personal-api/data/` is git-ignored (it holds your database and key), so `seed.sql` there is not committed. The generator in `tools/seed/` is.

### Rules for writing to the database directly

If you ever insert rows with SQL, these are what the app expects (the API enforces them when you use HTTP, but SQL bypasses it):

| Column | Rule |
|---|---|
| `Records.Id` | GUID text, e.g. `3f2c1a9e-...`. Anything else crashes every query that reads the row. |
| `Records.OccurredAt`, `CreatedAt` | **.NET ticks in UTC**, not Unix seconds: `unix_seconds * 10000000 + 621355968000000000`. Seconds are read as the year 0001. |
| `Records.Value` | A number or `NULL`. It should equal the tracker's `valueField` in `DataJson`. |
| `Records.DataJson` | JSON text that matches the tracker's fields (types, required fields, bounds, choices). |
| `(Source, ExternalId)` | Unique together. Reusing an `ExternalId` for a different tracker through the API returns 409. |
| `Kinds.Fields` | JSON array written with PascalCase keys and enum names: `{"Name":"hours","Type":"Number","Required":true,"Label":"Hours","Options":null,"Min":0,"Max":24,"Integer":false}`. `Type` is one of `Text`, `Number`, `Boolean`, `Date`, `Choice`. Lowercase keys load with blank names. |

## 2. Load testing with oha

oha is a command-line HTTP load generator. It is not part of this repo; install it once:

```powershell
winget install hatoo.oha      # then open a new terminal
oha --version
```

(Other ways: `cargo install oha`, or download a release binary from the project's GitHub releases.)

### Ground rules for useful numbers

1. **Never test against your real database.** Write tests add rows, and a heavy test can lock the file. Use a copy; the helper script below does this for you.
2. **Use a Release build in Production mode**, not the Visual Studio debug session. Debug builds and Development mode add overhead and logging that distort results.
3. **Seed first.** An empty database makes everything look fast. `/feed` and `/analytics/overview` read every record, so their cost grows with data.
4. **Warm up.** The first requests pay for JIT compilation and model setup. Send a few hundred requests before measuring.
5. **Use `127.0.0.1`, not `localhost`.** On Windows `localhost` can try IPv6 first and add delay or errors.
6. **Run oha on the same Windows machine as the API.** WSL cannot reach a Windows `localhost`.
7. **Change one thing at a time**, and keep the machine otherwise quiet (close the IDE debugger, builds, browsers with dashboards open).
8. **Step the concurrency yourself.** oha has no ramp option. Run the same test at 1, 10, 50, 100 connections and look for the point where requests per second stops growing and latency climbs.
9. **Look at errors before speed.** A fast run full of 500s means nothing. Check the status code distribution first, then p99.

### The efficient way: the helper script

`tools/loadtest/run-oha.ps1` does the setup and the stepping for you:

```powershell
# everything, default levels (1, 10, 50, 100 connections, 15 seconds each)
powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1

# only the heavy endpoints, more levels, longer runs
powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -Endpoints feed,overview30,overview365 -Levels 1,5,10,25,50 -Duration 30s

# a fixed 200 requests per second with latency correction (see below)
powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -QueriesPerSecond 200 -Levels 50 -Endpoints feed
```

It copies the database (a consistent online copy; your original is only read), publishes a Release build once, starts it on `http://127.0.0.1:5400` in Production mode with warning-level logging, warms up, runs oha for each endpoint and level, prints a wide table (requests, requests per second, min/mean/p50/p90/p95/p99/p99.9/max latency in ms, KB/s, success percent, non-2xx, failed, cut-off and failure detail), and saves `summary.csv`, the raw oha JSON for every run, and **`report.html`** (opens automatically) to `%TEMP%\personal-api-loadtest\<timestamp>\`. `report.html` has charts for requests per second and p99 against connections, latency percentiles per endpoint, a latency histogram for every run, and a bar per run showing 2xx, HTTP errors, timeouts/connection errors and requests cut off at the deadline. **Failed** means a timeout or connection error; **Cut off** means a request still running when the timer ended (expected, not a failure). **Cold test:** add `-Cold` for a cold-start run. It skips the warm-up and starts a brand new API process for every endpoint, so each one is measured from a freshly started server (JIT compiling, EF model, caches, connection pool all cold). It also times the very first request to each endpoint (`<endpoint>-first.json`, `first-request.csv`, and a Cold start chart in the report). The operating system's file cache stays warm, so this is cold for the app, not for the disk. Run once normally and once with `-Cold` to see the gap. `-Timeout 5s` sets the per-request timeout (default 10s) and `-NoReport` skips the HTML. Rebuild a report from any old folder with `python tools/loadtest/make_report.py <folder> --open`. oha itself only draws a live chart in its terminal screen; the report is built from its JSON, which has no requests-per-second-over-time data. It always stops the API it started. Endpoint names: `health`, `kinds`, `records`, `feed`, `series`, `overview30`, `overview365`, `compare`. Use `-SourceDb` to point at a different database file and `-SkipPublish` to reuse the last build.

It needs oha, the .NET SDK and Python 3 on the PATH.

### Doing it by hand

Start the API on a database copy first (replace the paths):

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Production'
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5400'
$env:ConnectionStrings__Default = 'Data Source=C:\temp\load.db'
$env:Logging__LogLevel__Default = 'Warning'
dotnet run -c Release --no-launch-profile --project personal-api
```

Then, in another terminal:

```powershell
$url = 'http://127.0.0.1:5400'

# 1. baseline with no auth and no database: the cost of the framework alone
oha -z 15s -c 50 --no-tui "$url/health"

# 2. an authenticated read (adds the key check, which queries the database on every request)
oha -z 15s -c 50 --no-tui "$url/kinds"

# 3. a heavy read, saved as JSON
oha -z 30s -c 25 --no-tui --output-format json -o feed.json "$url/feed"

# 4. a fixed rate with latency correction (a realistic client that does not slow down when the server does)
oha -z 30s -c 50 -q 200 --latency-correction --no-tui "$url/feed"

# 5. no connection reuse (new connection per request)
oha -z 15s -c 50 --disable-keepalive --no-tui "$url/kinds"
```

Useful flags (from the oha README): `-z` duration, `-n` request count, `-c` connections, `-q` rate in requests per second, `--latency-correction`, `-H` header, `-m` method, `-d` inline body, `-D` body from a file, `-Z` body from a file line by line, `-T` content type, `-t` per-request timeout, `--no-tui`, `--output-format json|csv|text`, `-o` output file, `--stats-success-breakdown`, `--debug` (sends one request and prints the request and response, a good first check).

**Write tests** (only against a copy). Put the body in a file to avoid PowerShell quoting problems:

```powershell
Set-Content body.json '{"kind":"note","data":{"text":"load test"}}'
oha -z 15s -c 20 --no-tui -m POST -T application/json -D body.json "$url/records"
```

That inserts a new row per request. To measure the upsert path instead, add a fixed `"externalId":"lt-1"` to the body: every request then updates the same row. For unique ids per request, generate one JSON object per line and use `-Z`:

```powershell
1..5000 | ForEach-Object { '{"kind":"note","externalId":"lt-' + $_ + '","data":{"text":"load test"}}' } | Set-Content bodies.jsonl
oha -n 5000 -c 20 --no-tui -m POST -T application/json -Z bodies.jsonl "$url/records"
```

Check with `--debug` that the request looks right before a long run.

### Reading the results

- **Status code distribution first.** Anything other than 200 (or 201 for POST) is the story. 500 means look at the API console, 429 is not used by this API (it has no rate limiting; add some before exposing it to the internet).
- **Requests per second vs connections.** Healthy: it rises with connections, then flattens. The flat part is the capacity.
- **p50 vs p95 vs p99.** A p99 far above p95 usually means queueing, garbage collection or database lock waits.
- **Closed loop vs fixed rate.** A plain `-c` run slows down when the server slows down, which hides queueing (coordinated omission). A `-q` run with `--latency-correction` shows what a client at a steady rate would feel.
- **Compare endpoints.** `/health` vs `/kinds` shows what the key check plus one query costs; `/kinds` vs `/feed` shows the cost of reading data.
- **Watch the API process.** If one core is pinned at 100 percent while the machine is idle, you are CPU bound; if CPU is low and latency is high, look at the database.

### What to expect on this API

Single sequential requests on the seeded demo database (about 7,200 records, 61 trackers), a Debug build, warm, measured from WSL so each includes a small network hop. Treat them as a rough baseline; a Release build is faster.

| Endpoint | Median | p95 | Response size |
|---|---|---|---|
| `/health` (no auth, no database) | 1.4 ms | 2.3 ms | 15 B |
| `/kinds` | 3.4 ms | 3.9 ms | 31 KB |
| `/records?limit=100` | 4.2 ms | 5.2 ms | 31 KB |
| `/series/sleep?days=30` | 3.6 ms | 14 ms | 2.5 KB |
| `/analytics/compare` (6 trackers, 90 days) | 9.1 ms | 10 ms | 7 KB |
| `/feed` | 45 ms | 72 ms | 6 KB |
| `/analytics/overview?days=30` | 57 ms | 114 ms | 73 KB |
| `/analytics/overview?days=365` | 119 ms | 175 ms | 264 KB |

So the heavy endpoints are `/feed` and `/analytics/overview`: they read every tracker's records, so they are the ones to test with lower concurrency and to re-test as your data grows. The cheap reads should sustain far more throughput.

### Things that will show up

- **SQLite allows one writer at a time.** Concurrent POSTs queue; reads continue (the database uses write-ahead logging). Expect write throughput to flatten early.
- **A tracker with more than 20,000 records** cannot be charted or turned into feed cards yet (the API refuses rather than return wrong numbers). Seeded data stays far below that; real imports might not.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Connection refused, or every request fails | The API is not running, wrong port, or you used `localhost` (use `127.0.0.1`) |
| 500 on `/records` or `/analytics/overview` | Rows with non-GUID ids or Unix-second dates; run `seed.sql` (step 1 removes them) |
| Strange timeouts at high `-c` | The operating system's open-file or connection limits; lower `-c`, or add `-t 5s` to see timeouts as errors |
| Numbers vary a lot between runs | Debug build, a debugger attached, background work on the machine, or no warm-up |

## 3. The read cache

The API keeps an in-memory cache in front of the read-heavy endpoints: `/feed`, `/analytics/overview|compare|pair`, `/records` and `/kinds`. `/series` is not cached (it is already fast and its default time window changes on every request).

- **Freshness:** an entry lives for `Cache:TtlSeconds` (default 30). Any record or tracker write (`POST /records`, `PUT /kinds/{key}`) clears the whole cache, so you see your own changes at once. Writing to the database directly with SQL (like `seed.sql`) does not clear it; the data shows up after at most the TTL, or after restarting the API.
- **Settings** (`appsettings.json`, section `Cache`): `Enabled` (default true), `TtlSeconds` (1 to 3600), `MaxEntries` (default 512; the cache is emptied when it grows past this).
- **Off switch:** `Cache:Enabled=false` (or the environment variable `Cache__Enabled=false`) registers no cache at all. That is the baseline.
- **Look inside:** `GET /cache/stats` returns hits, misses, hit rate, entries and invalidations since the API started.
- **Same requests share work:** if 100 requests ask for the same uncached result at once, one computes it and the rest wait for that answer.
- **Where it lives:** `personal-api/Caching/`. The cache wraps the existing interfaces (`IFeedService`, `IAnalyticsService`, `IRecordStore`, `IKindStore`), so the services themselves are unchanged. It is in one process, so it will not be shared if you run several API instances.

### Measure what it buys

Run the same test with and without the cache and compare the two reports (the report header says which is which):

```powershell
powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -Endpoints feed,records,overview30,overview365,compare -Levels 1,10,50
powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -Endpoints feed,records,overview30,overview365,compare -Levels 1,10,50 -NoCache
```

The script prints the cache hits and misses after each endpoint. A steady load test hits the same URL again and again, so it shows the best case; real use has more variety and writes that clear the cache.

## 4. Cold-start tuning

The first request to a freshly started server is slow because .NET compiles code on demand (JIT), builds the Entity Framework model, opens the first database connections and computes the first answers. Four things reduce it:

| Practice | What it does | Setting |
|---|---|---|
| **Pre-warm** | Before the server starts listening, runs the common reads once (kinds, records, feed, overview for the `Warmup:OverviewDays` ranges). That compiles the code paths and builds the EF model. | `Warmup:Enabled` (default true) |
| **Eager caching** | The same pre-warm fills the cache. A background service then refreshes it at 75% of the TTL and about a second after any write, so readers rarely wait on a miss. The old answer keeps being served until the new one is ready. | `Warmup:RefreshAhead` (default true) |
| **Connection pooling** | `AddDbContextPool` reuses DbContext objects. SQLite connections are pooled by default; the pre-warm opens `Warmup:Connections` of them at once so the first burst finds them ready. | `Warmup:Connections` (default 8) |
| **Ahead-of-time compilation** | A ReadyToRun publish ships the code pre-compiled, so far less JIT work happens at start. Native AOT is not an option here (EF Core and MVC rely on reflection). | publish flag below |

Pre-warm happens before the first request, so the cost moves into start-up time: `/health` answers later but the first real request is fast. The load test prints "ready to serve N ms after launch" so you can see both sides.

### Publish a ReadyToRun build

```powershell
dotnet publish personal-api\personal-api.csproj -c Release -r win-x64 --self-contained false -p:PublishReadyToRun=true -o publish
```

`run-oha.ps1` publishes this way by default. Use `-NoReadyToRun` for a plain JIT build and `-NoWarmup` to switch the pre-warm and eager refresh off, then compare cold runs:

```powershell
powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -Cold -Levels 1 -Duration 2s                              # everything on
powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -Cold -Levels 1 -Duration 2s -NoReadyToRun -NoWarmup      # the old behaviour
```

Data written with SQL behind the API's back (like `seed.sql`) is picked up at the next refresh, within the cache TTL.

### Measured on the 7,183-record seeded database (first request to a freshly started server, ms)

Median of 5 fresh starts per cell (a new process for every endpoint, runs interleaved across variants).

| Build | kinds | records | series | feed | overview 30d | overview 365d | compare | until `/health` answers |
|---|---|---|---|---|---|---|---|---|
| Plain build, no warm-up | 29.4 | 39.1 | 43.7 | 92.4 | 153.5 | 208.8 | 68.2 | 1,070 ms |
| ReadyToRun only | 25.4 | 33.0 | 36.1 | 74.7 | 134.0 | 175.1 | 54.4 | 556 ms |
| Warm-up only (plain build) | 24.3 | 30.6 | 27.1 | 24.7 | 34.2 | 39.7 | 42.3 | 1,071 ms |
| Warm-up, cache off | 25.3 | 32.1 | 27.8 | 58.6 | 89.9 | 148.9 | 43.1 | 1,069 ms |
| Warm-up, no pre-opened connections | 23.7 | 31.5 | 27.7 | 25.5 | 33.7 | 38.2 | 42.8 | 1,070 ms |
| ReadyToRun + warm-up | 22.8 | 30.0 | 27.6 | 23.0 | 30.8 | 37.0 | 38.5 | 1,068 ms |

Reading it: ReadyToRun alone starts about twice as fast but leaves the first heavy request slow. Warm-up removes the slow first requests, mostly because the first request becomes a read from the filled cache (compare the "cache off" row), but costs start-up time. Pre-opened connections made no measurable difference. Together, the server is ready as soon as the plain build was, and the first heavy request is 4 to 5.6 times faster. The "until `/health` answers" column includes serving that first health request, which is why the plain build is not faster than warm-up. Same machine as the API; the numbers are for comparing builds, not absolute.
