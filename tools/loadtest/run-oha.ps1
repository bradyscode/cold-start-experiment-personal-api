<#
.SYNOPSIS
  Load test the Personal API with oha (https://github.com/hatoo/oha) against a COPY of a database.

.DESCRIPTION
  1. Copies the source database (a consistent online backup via Python's sqlite3) to a temp folder.
     Your real database is only read, never written.
  2. Publishes a Release build, starts it in Production mode on 127.0.0.1 with warning-level logging, and waits for /health.
  3. Warms every endpoint up (JIT, EF model, caches) so the measured runs are steady state.
  4. For each endpoint and each concurrency level runs oha for -Duration and saves the raw JSON.
     oha has no ramp mode, so stepping the concurrency levels is how you find where throughput stops growing.
  5. Prints a table (requests per second, p50/p95/p99 in ms, success rate, non-2xx count) and writes summary.csv.
  6. Always stops the API it started, even when something fails.

.PARAMETER SourceDb      Database to copy. Default personal-api\data\personal-api.db (best: a seeded copy, see docs\seeding-and-load-testing.md).
.PARAMETER Levels        Comma-separated concurrent connections to step through. Default 1,10,50,100.
.PARAMETER Duration      Length of each measured run, oha syntax. Default 15s.
.PARAMETER Endpoints     Comma-separated names to run: health, kinds, records, feed, series, overview30, overview365, compare. Default all.
.PARAMETER QueriesPerSecond  When > 0 runs at a fixed rate (-q) with --latency-correction instead of "as fast as possible".
.PARAMETER Cold          Cold-start test: NO warm-up, and a brand new API process for every endpoint, so each endpoint is measured from a freshly started server (JIT, EF model, caches and connection pool all cold). Also records the very first request to each endpoint as <endpoint>-first.json. The OS file cache stays warm, so it is cold for the app, not for the disk.
.PARAMETER NoCache       Start the API with Cache:Enabled=false (the baseline). Run once with and once with -NoCache to see what the cache buys. The API's /cache/stats hits and misses are printed per endpoint.
.PARAMETER NoWarmup      Start the API with Warmup:Enabled=false (no start-up pre-warm and no eager cache refresh). Combine with -Cold to see the raw cold-start cost.
.PARAMETER NoReadyToRun  Publish a plain JIT build instead of the default ReadyToRun (ahead-of-time pre-compiled) build, into a separate folder. Needs no extra download.
.PARAMETER Timeout       Per-request timeout, oha syntax (oha -t). A request slower than this counts as a failed (timed out) request. Default 10s.
.PARAMETER NoReport      Skip building report.html (charts) and summary-detailed.csv.
.PARAMETER Port          Port for the temporary API. Default 5400.
.PARAMETER Oha           Path or name of the oha executable. Default oha.
.PARAMETER OutDir        Where results go. Default %TEMP%\personal-api-loadtest\<timestamp>.
.PARAMETER SkipPublish   Reuse the publish folder from a previous run in OutDir's parent (faster reruns).

.EXAMPLE
  # everything, defaults
  powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1

.EXAMPLE
  # cold start: fresh server per endpoint, no warm-up, first-request time recorded
  powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -Cold -Levels 1,10,50 -Duration 10s

.EXAMPLE
  # only the heavy read endpoints, longer runs, more levels
  powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -Endpoints feed,overview30,overview365 -Levels 1,5,10,25,50 -Duration 30s

.EXAMPLE
  # fixed 200 requests per second with latency correction (shows queueing the closed-loop run hides)
  powershell -ExecutionPolicy Bypass -File tools\loadtest\run-oha.ps1 -QueriesPerSecond 200 -Levels 50 -Endpoints feed

Requires: oha on PATH (winget install hatoo.oha), the .NET SDK, and Python 3 (python or py) for the safe database copy.
#>
[CmdletBinding()]
param(
    [string]$SourceDb = (Join-Path $PSScriptRoot '..\..\personal-api\data\personal-api.db'),
    [string]$Levels = '1,10,50,100',   # comma-separated; kept as text because powershell -File does not parse arrays
    [string]$Duration = '15s',
    [string]$Endpoints = '',            # comma-separated names; empty = all
    [int]$QueriesPerSecond = 0,
    [string]$Timeout = '10s',
    [switch]$Cold,
    [switch]$NoCache,
    [switch]$NoWarmup,
    [switch]$NoReadyToRun,
    [switch]$NoReport,
    [int]$Port = 5400,
    [string]$Oha = 'oha',
    [string]$OutDir = '',
    [switch]$SkipPublish
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$root = Join-Path $env:TEMP 'personal-api-loadtest'
if (-not $OutDir) { $OutDir = Join-Path $root (Get-Date -Format 'yyyyMMdd-HHmmss') }
$publishDir = Join-Path $root $(if ($NoReadyToRun) { 'publish-jit' } else { 'publish-r2r' })
$dataDir = Join-Path $OutDir 'data'
$base = "http://127.0.0.1:$Port"

# name -> path (the compare call is built from trackers every seeded database has)
$all = [ordered]@{
    health      = '/health'
    kinds       = '/kinds'
    records     = '/records?limit=100'
    feed        = '/feed'
    series      = '/series/sleep?days=30'
    overview30  = '/analytics/overview?days=30'
    overview365 = '/analytics/overview?days=365'
    compare     = '/analytics/compare?kinds=sleep,mood,steps,caffeine,github_commit,claude_usage&days=90'
}
$levelList = @($Levels -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })
$endpointList = if ($Endpoints.Trim()) { @($Endpoints -split '[,\s]+' | Where-Object { $_ }) } else { @($all.Keys) }
foreach ($e in $endpointList) { if (-not $all.Contains($e)) { throw "Unknown endpoint '$e'. Choose from: $($all.Keys -join ', ')" } }

function Find-Python {
    foreach ($candidate in 'python', 'py') {
        if (Get-Command $candidate -ErrorAction SilentlyContinue) { return $candidate }
    }
    throw 'Python 3 is needed for the safe database copy (python or py on PATH).'
}

if (-not (Get-Command $Oha -ErrorAction SilentlyContinue) -and -not (Test-Path $Oha)) {
    throw "oha was not found. Install it with: winget install hatoo.oha   (then open a new terminal)"
}
if (-not (Test-Path $SourceDb)) { throw "Source database not found: $SourceDb" }

New-Item -ItemType Directory -Force -Path $OutDir, $dataDir | Out-Null
Write-Host "Results folder: $OutDir"
Write-Host "oha: $(& $Oha --version)"

# ---- 1. consistent copy of the database ----
$py = Find-Python
$copy = Join-Path $dataDir 'load.db'
$pyFile = Join-Path $dataDir 'copydb.py'
@'
import sqlite3, sys
src = sqlite3.connect("file:" + sys.argv[1].replace("\\", "/") + "?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.commit()
n = dst.execute("SELECT COUNT(*) FROM Records").fetchone()[0]
k = dst.execute("SELECT COUNT(*) FROM Kinds").fetchone()[0]
print(f"copied database: {n} records, {k} trackers")
'@ | Set-Content -Path $pyFile -Encoding UTF8
& $py $pyFile (Resolve-Path $SourceDb).Path $copy
if ($LASTEXITCODE -ne 0) { throw 'Could not copy the database.' }

# ---- 2. Release build ----
if (-not $SkipPublish -or -not (Test-Path (Join-Path $publishDir 'personal-api.dll'))) {
    Write-Host 'Publishing a Release build (once; use -SkipPublish to reuse it)...'
    $publishArgs = @('-c', 'Release', '-o', $publishDir, '--nologo', '-v', 'quiet')
    if (-not $NoReadyToRun) { $publishArgs += @('-r', 'win-x64', '--self-contained', 'false', '-p:PublishReadyToRun=true') }
    & dotnet publish (Join-Path $repo 'personal-api\personal-api.csproj') @publishArgs
    if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed.' }
}

# ---- 3. API process helpers (the only process this script ever stops) ----
$script:api = $null
$script:readyMs = New-Object System.Collections.Generic.List[double]
function Start-Api {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = 'dotnet'
    $startInfo.Arguments = "`"$(Join-Path $publishDir 'personal-api.dll')`""
    $startInfo.WorkingDirectory = $dataDir
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables['ASPNETCORE_ENVIRONMENT'] = 'Production'
    $startInfo.EnvironmentVariables['ASPNETCORE_URLS'] = $base
    $startInfo.EnvironmentVariables['ConnectionStrings__Default'] = "Data Source=$copy"
    $startInfo.EnvironmentVariables['Logging__LogLevel__Default'] = 'Warning'
    if ($NoWarmup) { $startInfo.EnvironmentVariables['Warmup__Enabled'] = 'false' }
    if ($NoCache) { $startInfo.EnvironmentVariables['Cache__Enabled'] = 'false' }
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $script:api = [System.Diagnostics.Process]::Start($startInfo)
    Write-Host "Started the API (pid $($script:api.Id)) on $base, waiting for /health..."
    $ready = $false
    for ($i = 0; $i -lt 1500 -and -not $ready; $i++) {
        if ($script:api.HasExited) { throw "The API exited early with code $($script:api.ExitCode); see the console output above." }
        # curl.exe fails without PowerShell's slow exception path, so the measured start-up time is not rounded up to the poll cost
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            $ready = (& curl.exe -s -o NUL -w '%{http_code}' --max-time 2 "$base/health") -eq '200'
            if (-not $ready) { Start-Sleep -Milliseconds 20 }
        }
        else {
            try { $ready = (Invoke-WebRequest "$base/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { Start-Sleep -Milliseconds 50 }
        }
    }
    if (-not $ready) { throw 'The API did not become healthy within 30 seconds.' }
    Write-Host ("  ready to serve {0:N0} ms after launch" -f $clock.Elapsed.TotalMilliseconds)
    $script:readyMs.Add([math]::Round($clock.Elapsed.TotalMilliseconds, 0))
}
function Show-CacheStats([string]$label) {
    try {
        $c = Invoke-RestMethod "$base/cache/stats" -TimeoutSec 5
        if ($c.enabled) {
            $st = $c.stats
            Write-Host ("  cache after {0}: {1} hits, {2} misses ({3:P1} hit rate), {4} entries" -f $label, $st.hits, $st.misses, $st.hitRate, $st.entries)
        } else { Write-Host "  cache after ${label}: disabled" }
    } catch { Write-Warning "Could not read /cache/stats: $($_.Exception.Message)" }
}
function Stop-Api {
    if ($script:api -and -not $script:api.HasExited) {
        Stop-Process -Id $script:api.Id -Force; $script:api.WaitForExit(5000) | Out-Null
        Write-Host "Stopped the API (pid $($script:api.Id))."
    }
}
[pscustomobject]@{ cache = (-not $NoCache); warmup = (-not $NoWarmup); r2r = (-not $NoReadyToRun); cold = [bool]$Cold; levels = $levelList; duration = $Duration; endpoints = $endpointList } | ConvertTo-Json -Compress | Set-Content (Join-Path $OutDir 'run-info.json')
$rows = New-Object System.Collections.Generic.List[object]
$firstRows = New-Object System.Collections.Generic.List[object]

function Measure-Endpoint([string]$e) {
    if ($Cold) {
        # the very first request a fresh server answers
        $firstFile = Join-Path $OutDir "$e-first.json"
        & $Oha -n 1 -c 1 -t $Timeout --no-tui --output-format json -o $firstFile "$base$($all[$e])" | Out-Null
        if (Test-Path $firstFile) {
            $f = Get-Content $firstFile -Raw | ConvertFrom-Json
            $code = ($f.statusCodeDistribution.PSObject.Properties | ForEach-Object { $_.Name }) -join ','
            $firstRows.Add([pscustomobject]@{ Endpoint = $e; 'First request ms' = [math]::Round($f.summary.average * 1000, 1); Status = $code })
            Write-Host ("  {0,-12} first request on a cold server: {1} ms (HTTP {2})" -f $e, $firstRows[$firstRows.Count - 1].'First request ms', $code)
        }
    }
    foreach ($level in $levelList) {
        $file = Join-Path $OutDir "$e-c$level.json"
        $ohaArgs = @('-z', $Duration, '-c', "$level", '-t', $Timeout, '--no-tui', '--output-format', 'json', '-o', $file)
        if ($QueriesPerSecond -gt 0) { $ohaArgs += @('-q', "$QueriesPerSecond", '--latency-correction') }
        $ohaArgs += "$base$($all[$e])"
        Write-Host ("  {0,-12} c={1,-4} for {2} ..." -f $e, $level, $Duration)
        & $Oha @ohaArgs | Out-Null
        if (-not (Test-Path $file)) { Write-Warning "no result file for $e c=$level"; continue }
        try {
            $r = Get-Content $file -Raw | ConvertFrom-Json
            $non2xx = 0; $total = 0
            foreach ($p in $r.statusCodeDistribution.PSObject.Properties) { $total += [int]$p.Value; if (-not $p.Name.StartsWith('2')) { $non2xx += [int]$p.Value } }
            $failed = 0; $cutoff = 0; $failText = @()
            foreach ($p in $r.errorDistribution.PSObject.Properties) {
                if ($p.Name -eq 'aborted due to deadline') { $cutoff += [int]$p.Value; continue }
                $failed += [int]$p.Value; $failText += "$($p.Name) x$($p.Value)"
            }
            $total += $failed
            $lat = $r.latencyPercentiles
            $rows.Add([pscustomobject]@{
                Endpoint = $e; Conns = $level; Requests = $total
                'Req/s'  = [math]::Round($r.summary.requestsPerSec, 1)
                'Min ms' = [math]::Round($r.summary.fastest * 1000, 2); 'Mean ms' = [math]::Round($r.summary.average * 1000, 2)
                'p50 ms' = [math]::Round($lat.p50 * 1000, 2); 'p90 ms' = [math]::Round($lat.p90 * 1000, 2)
                'p95 ms' = [math]::Round($lat.p95 * 1000, 2); 'p99 ms' = [math]::Round($lat.p99 * 1000, 2)
                'p99.9 ms' = [math]::Round($lat.'p99.9' * 1000, 2); 'Max ms' = [math]::Round($r.summary.slowest * 1000, 2)
                'KB/s'   = [math]::Round($r.summary.sizePerSec / 1024, 0); 'B/req' = [math]::Round($r.summary.sizePerRequest, 0)
                'Success %' = [math]::Round($r.summary.successRate * 100, 2)
                'Non-2xx' = $non2xx; Failed = $failed; 'Cut off' = $cutoff
                'Failure detail' = ($failText -join '; ')
            })
        } catch {
            Write-Warning "Could not parse $file ($($_.Exception.Message)); the raw JSON is kept there."
        }
    }
}

try {
    if ($Cold) {
        Write-Host 'COLD mode: no warm-up; a fresh API process per endpoint.'
        foreach ($e in $endpointList) {
            Start-Api
            Measure-Endpoint $e
            Show-CacheStats $e
            Stop-Api
        }
    }
    else {
        Start-Api
        Write-Host 'Warming up...'
        foreach ($e in $endpointList) { & $Oha -n 300 -c 10 --no-tui "$base$($all[$e])" | Out-Null }
        foreach ($e in $endpointList) { Measure-Endpoint $e; Show-CacheStats $e }
    }
}
finally {
    Stop-Api
}

# ---- 6. results ----
if ($script:readyMs.Count -gt 0) {
    Write-Host ('Time from launch until /health answered (ms): ' + (($script:readyMs | ForEach-Object { $_ }) -join ', '))
}
if ($firstRows.Count -gt 0) {
    Write-Host 'First request to each freshly started server:'
    $firstRows | Format-Table -AutoSize
    $firstRows | Export-Csv -NoTypeInformation -Path (Join-Path $OutDir 'first-request.csv')
}
if ($rows.Count -gt 0) {
    $rows | Format-Table -AutoSize -Wrap
    $rows | Export-Csv -NoTypeInformation -Path (Join-Path $OutDir 'summary.csv')
    Write-Host "Table saved to $(Join-Path $OutDir 'summary.csv'); raw oha JSON per run is in $OutDir"
    Write-Host "Failed = timeouts and connection errors. Cut off = requests still running when the timer ended (expected, not a failure)."
    if (-not $NoReport) {
        $report = Join-Path $OutDir 'report.html'
        & $py (Join-Path $PSScriptRoot 'make_report.py') $OutDir
        if ($LASTEXITCODE -eq 0 -and (Test-Path $report)) { Write-Host "Charts: $report"; Start-Process $report }
    }
}
