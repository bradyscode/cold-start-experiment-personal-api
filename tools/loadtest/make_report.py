#!/usr/bin/env python3
"""Build a self-contained HTML report (charts + full table) from the oha JSON files of one load-test run.

Usage:
  python tools/loadtest/make_report.py <results-folder> [--open]

  <results-folder>  the folder run-oha.ps1 printed ("Results folder: ..."), holding <endpoint>-c<connections>.json files.
  --open            open report.html in the default browser afterwards.

Writes <results-folder>/report.html and <results-folder>/summary-detailed.csv. Standard library only, no internet needed.
oha only reports latency/throughput aggregates, so there is no requests-per-second-over-time chart.
"""
import csv
import glob
import html
import json
import os
import re
import sys

DEADLINE = "aborted due to deadline"
PCTS = ["p10", "p25", "p50", "p75", "p90", "p95", "p99", "p99.9"]
COLORS = ["#7c8cff", "#34d399", "#fbbf24", "#f472b6", "#38bdf8", "#fb923c", "#a78bfa", "#f87171"]


def ms(v):
    return None if v is None else v * 1000.0


def load(folder):
    runs = []
    for path in glob.glob(os.path.join(folder, "*-c*.json")):
        m = re.match(r"(.+)-c(\d+)\.json$", os.path.basename(path))
        if not m:
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                r = json.load(fh)
        except (OSError, ValueError):
            continue
        s, lat, fb = r.get("summary", {}), r.get("latencyPercentiles", {}), r.get("firstBytePercentiles", {})
        codes = {k: int(v) for k, v in (r.get("statusCodeDistribution") or {}).items()}
        errs = {k: int(v) for k, v in (r.get("errorDistribution") or {}).items()}
        ok = sum(v for k, v in codes.items() if k.startswith("2"))
        bad = sum(v for k, v in codes.items() if not k.startswith("2"))
        aborted = errs.get(DEADLINE, 0)
        failed = sum(v for k, v in errs.items() if k != DEADLINE)
        details = r.get("details") or {}
        dial = (details.get("DNSDialup") or {}).get("average")
        hist = r.get("responseTimeHistogram") or {}
        runs.append({
            "endpoint": m.group(1), "conns": int(m.group(2)),
            "total": ok + bad + failed, "ok": ok, "non2xx": bad, "failed": failed, "aborted": aborted,
            "codes": codes, "errors": {k: v for k, v in errs.items() if k != DEADLINE},
            "duration": s.get("total"), "rps": s.get("requestsPerSec"), "success": (s.get("successRate") or 0) * 100,
            "min": ms(s.get("fastest")), "mean": ms(s.get("average")), "max": ms(s.get("slowest")),
            "lat": {p: ms(lat.get(p)) for p in PCTS}, "ttfb50": ms(fb.get("p50")), "ttfb99": ms(fb.get("p99")),
            "dial_ms": ms(dial), "bytes_req": s.get("sizePerRequest"), "kb_s": (s.get("sizePerSec") or 0) / 1024.0,
            "hist": sorted((float(k) * 1000.0, int(v)) for k, v in hist.items()),
        })
    runs.sort(key=lambda x: (x["endpoint"], x["conns"]))
    return runs


def load_first(folder):
    out = []
    for path in sorted(glob.glob(os.path.join(folder, "*-first.json"))):
        try:
            with open(path, encoding="utf-8") as fh:
                r = json.load(fh)
        except (OSError, ValueError):
            continue
        codes = ",".join((r.get("statusCodeDistribution") or {}).keys()) or "no response"
        out.append((os.path.basename(path)[:-len("-first.json")], ms((r.get("summary") or {}).get("average")) or 0.0, codes))
    return out


def first_chart(first, runs, w=980):
    """First request on a fresh server vs the p50 once running (1 connection)."""
    rowh, pad_l = 24, 110
    peak = max([f[1] for f in first] + [1.0])
    steady = {r["endpoint"]: r["lat"]["p50"] for r in runs if r["conns"] == min(x["conns"] for x in runs)}
    sc = scale(0, peak, 0, w - pad_l - 150)
    g = [f'<svg viewBox="0 0 {w} {len(first) * rowh + 8}" role="img" aria-label="first request latency">']
    for i, (e, v, code) in enumerate(first):
        y = 4 + i * rowh
        g.append(f'<text x="{pad_l - 8}" y="{y + 14}" class="ax" text-anchor="end">{html.escape(e)}</text>'
                 f'<rect x="{pad_l}" y="{y + 2}" width="{max(sc(v), 2):.1f}" height="{rowh - 8}" fill="#fbbf24"><title>{e}: first request {v:,.1f} ms</title></rect>')
        st = steady.get(e)
        if st is not None:
            g.append(f'<line x1="{pad_l + sc(st):.1f}" x2="{pad_l + sc(st):.1f}" y1="{y}" y2="{y + rowh - 4}" stroke="#34d399" stroke-width="2"><title>{e}: p50 afterwards {st:,.1f} ms</title></line>')
        g.append(f'<text x="{pad_l + max(sc(v), 2) + 6:.1f}" y="{y + 14}" class="ax">{v:,.1f} ms (HTTP {html.escape(code)})</text>')
    g.append("</svg>")
    return "".join(g) + '<div class="legend"><span><i style="background:#fbbf24"></i>very first request on a freshly started server</span><span><i style="background:#34d399"></i>p50 at the lowest concurrency tested, once running</span></div>'


def fmt(v, d=1):
    return "" if v is None else f"{v:,.{d}f}"


def write_csv(runs, path):
    cols = ["endpoint", "conns", "total", "ok", "non2xx", "failed", "aborted", "success", "rps", "min", "mean", "max",
            *PCTS, "ttfb50", "ttfb99", "dial_ms", "bytes_req", "kb_s"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols[:2] + ["total_requests", "http_2xx", "http_non2xx", "failed_requests", "aborted_at_deadline", "success_pct",
                               "rps", "min_ms", "mean_ms", "max_ms", *[f"{p}_ms" for p in PCTS],
                               "first_byte_p50_ms", "first_byte_p99_ms", "connect_avg_ms", "bytes_per_request", "kb_per_sec"])
        for r in runs:
            row = [r["endpoint"], r["conns"]]
            for c in cols[2:]:
                v = r["lat"][c] if c in PCTS else r[c]
                row.append("" if v is None else (round(v, 3) if isinstance(v, float) else v))
            w.writerow(row)


def scale(lo, hi, a, b):
    span = (hi - lo) or 1.0
    return lambda v: a + (v - lo) / span * (b - a)


def line_chart(title, subtitle, series, conns, ylabel, logy=False, w=560, h=250):
    """series: {name: {conns: value}}"""
    import math
    pad_l, pad_r, pad_t, pad_b = 54, 14, 14, 34
    vals = [v for s in series.values() for v in s.values() if v is not None and (v > 0 or not logy)]
    if not vals:
        return ""
    lo, hi = (min(vals), max(vals)) if logy else (0, max(vals))
    if logy:
        lo, hi = math.log10(lo) - 0.05, math.log10(hi) + 0.05
    else:
        hi *= 1.08
    xs = scale(0, len(conns) - 1 or 1, pad_l, w - pad_r)
    ys_raw = scale(lo, hi, h - pad_b, pad_t)
    ys = (lambda v: ys_raw(math.log10(v))) if logy else ys_raw
    g = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="{html.escape(title)}">']
    ticks = [lo + (hi - lo) * i / 4 for i in range(5)]
    for t in ticks:
        y = ys_raw(t)
        val = 10 ** t if logy else t
        g.append(f'<line x1="{pad_l}" x2="{w - pad_r}" y1="{y:.1f}" y2="{y:.1f}" class="grid"/>'
                 f'<text x="{pad_l - 6}" y="{y + 4:.1f}" class="ax" text-anchor="end">{val:,.0f}' + ('' if val >= 10 or not logy else '') + '</text>')
    for i, c in enumerate(conns):
        g.append(f'<text x="{xs(i):.1f}" y="{h - 12}" class="ax" text-anchor="middle">{c}</text>')
    g.append(f'<text x="{(pad_l + w - pad_r) / 2:.0f}" y="{h - 1}" class="ax" text-anchor="middle">concurrent connections</text>')
    for k, (name, s) in enumerate(series.items()):
        col = COLORS[k % len(COLORS)]
        pts = [(xs(i), ys(s[c])) for i, c in enumerate(conns) if s.get(c) is not None and (s[c] > 0 or not logy)]
        if len(pts) > 1:
            g.append(f'<polyline fill="none" stroke="{col}" stroke-width="2" points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}"/>')
        for i, c in enumerate(conns):
            if s.get(c) is not None and (s[c] > 0 or not logy):
                g.append(f'<circle cx="{xs(i):.1f}" cy="{ys(s[c]):.1f}" r="3.5" fill="{col}"><title>{html.escape(name)} @ {c}: {s[c]:,.1f}</title></circle>')
    g.append("</svg>")
    legend = "".join(f'<span><i style="background:{COLORS[k % len(COLORS)]}"></i>{html.escape(n)}</span>' for k, n in enumerate(series))
    return f'<figure><figcaption><b>{html.escape(title)}</b> <small>{html.escape(subtitle)}</small></figcaption>{"".join(g)}<div class="legend">{legend}</div></figure>'


def hist_chart(run, w=270, h=120):
    hist = run["hist"]
    if not hist:
        return ""
    peak = max(c for _, c in hist) or 1
    n = len(hist)
    bw = (w - 8) / n
    g = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="latency histogram">']
    for i, (x, c) in enumerate(hist):
        bh = (h - 30) * c / peak
        g.append(f'<rect x="{4 + i * bw:.1f}" y="{h - 22 - bh:.1f}" width="{max(bw - 1, 1):.1f}" height="{bh:.1f}" fill="#7c8cff"><title>{x:,.1f} ms: {c:,} requests</title></rect>')
    g.append(f'<text x="4" y="{h - 8}" class="ax">{hist[0][0]:,.1f} ms</text><text x="{w - 4}" y="{h - 8}" class="ax" text-anchor="end">{hist[-1][0]:,.1f} ms</text>')
    for p, col in (("p50", "#34d399"), ("p99", "#f87171")):
        v = run["lat"][p]
        if v is not None and hist[-1][0] > hist[0][0]:
            x = 4 + (v - hist[0][0]) / (hist[-1][0] - hist[0][0]) * (w - 8)
            x = min(max(x, 4), w - 4)
            g.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="4" y2="{h - 22}" stroke="{col}" stroke-dasharray="3 3"/><text x="{x:.1f}" y="12" class="ax" fill="{col}" text-anchor="{"end" if x > w / 2 else "start"}">{p}</text>')
    g.append("</svg>")
    return f'<div class="hist"><div class="hl">{run["conns"]} connections <small>{run["total"]:,} requests</small></div>{"".join(g)}</div>'


def outcome_chart(runs, w=980):
    """One bar per run: 2xx / non-2xx / failed (connection errors, timeouts) / aborted at deadline, as a share of everything sent."""
    rowh, pad_l, pad_t = 20, 150, 8
    h = pad_t + rowh * len(runs) + 26
    parts = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="request outcomes per run">']
    cats = [("ok", "#34d399", "2xx success"), ("non2xx", "#fbbf24", "HTTP error (non-2xx)"), ("failed", "#f87171", "failed: timeout / connection error"),
            ("aborted", "#64748b", "cut off by test deadline (not a failure)")]
    for i, r in enumerate(runs):
        y = pad_t + i * rowh
        tot = (r["ok"] + r["non2xx"] + r["failed"] + r["aborted"]) or 1
        parts.append(f'<text x="{pad_l - 8}" y="{y + 13}" class="ax" text-anchor="end">{html.escape(r["endpoint"])} c={r["conns"]}</text>')
        x = pad_l
        for key, col, label in cats:
            seg = (w - pad_l - 10) * r[key] / tot
            if seg > 0:
                min_seg = max(seg, 2.5) if key in ("non2xx", "failed") else seg
                parts.append(f'<rect x="{x:.1f}" y="{y + 2}" width="{min_seg:.1f}" height="{rowh - 6}" fill="{col}"><title>{html.escape(r["endpoint"])} c={r["conns"]}: {label} = {r[key]:,}</title></rect>')
                x += min_seg
    parts.append("</svg>")
    legend = "".join(f'<span><i style="background:{c}"></i>{html.escape(l)}</span>' for _, c, l in cats)
    return "".join(parts) + f'<div class="legend">{legend}</div>'


CSS = """
:root{--bg:#0e1020;--card:#171a2e;--fg:#e6e8f5;--mut:#98a0c0;--grid:#2a2f4d;--bad:#f87171;--good:#34d399}
@media (prefers-color-scheme:light){:root{--bg:#f5f6fb;--card:#fff;--fg:#1b1e33;--mut:#5b6385;--grid:#dfe2f0}}
*{box-sizing:border-box}body{margin:0;padding:20px 16px 60px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:34px 0 10px}h3{font-size:15px;margin:22px 0 8px}
p,small{color:var(--mut)}.card{background:var(--card);border-radius:12px;padding:14px 16px;margin:12px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.kpi{background:var(--card);border-radius:12px;padding:12px 14px}
.kpi b{display:block;font-size:22px}.kpi span{color:var(--mut);font-size:12px}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}figure{margin:0;background:var(--card);border-radius:12px;padding:12px}
figcaption{margin-bottom:4px}svg{width:100%;height:auto;display:block}.grid{stroke:var(--grid)}.ax{fill:var(--mut);font-size:10px}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;color:var(--mut);font-size:12px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.hists{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.hist{background:var(--card);border-radius:12px;padding:10px}.hl{font-size:12px;margin-bottom:2px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}
th,td{padding:5px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--grid)}th:first-child,td:first-child{text-align:left;position:sticky;left:0;background:var(--card)}
th{color:var(--mut);font-weight:600}.bad{color:var(--bad);font-weight:700}.good{color:var(--good)}tr.sep td{border-top:2px solid var(--grid)}
@media (max-width:600px){body{padding:14px 10px 50px}}
"""


def build(runs, folder):
    first = load_first(folder)
    endpoints = sorted({r["endpoint"] for r in runs}, key=lambda e: [x["endpoint"] for x in runs].index(e))
    conns = sorted({r["conns"] for r in runs})
    total = sum(r["total"] for r in runs)
    hard = sum(r["non2xx"] + r["failed"] for r in runs)
    aborted = sum(r["aborted"] for r in runs)
    slow = max(runs, key=lambda r: r["lat"]["p99"] or 0)
    fast = max(runs, key=lambda r: r["rps"] or 0)
    mode = ""
    try:
        with open(os.path.join(folder, "run-info.json"), encoding="utf-8") as fh:
            info = json.load(fh)
        mode = f" &middot; <b>{'cold start' if info.get('cold') else 'warm'}</b> &middot; <b>cache {'on' if info.get('cache') else 'OFF'}</b> &middot; <b>warm-up {'on' if info.get('warmup', True) else 'OFF'}</b> &middot; <b>{'ReadyToRun' if info.get('r2r', False) else 'JIT'} build</b>"
    except (OSError, ValueError):
        pass
    o = [f"<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Load test report</title><style>{CSS}</style><body><main>",
         "<h1>Load test report</h1>", f"<p>{html.escape(os.path.basename(os.path.abspath(folder)))} &middot; {len(runs)} runs &middot; {len(endpoints)} endpoints &middot; concurrency {', '.join(map(str, conns))}{mode}</p>"]
    o.append('<div class="kpis">'
             f'<div class="kpi"><b>{total:,}</b><span>requests sent</span></div>'
             f'<div class="kpi"><b class="{"bad" if hard else "good"}">{hard:,}</b><span>real failures (non-2xx + timeouts/connection errors)</span></div>'
             f'<div class="kpi"><b>{aborted:,}</b><span>cut off at the test deadline (expected, not failures)</span></div>'
             f'<div class="kpi"><b>{fmt(fast["rps"], 0)}</b><span>best requests/sec ({html.escape(fast["endpoint"])} c={fast["conns"]})</span></div>'
             f'<div class="kpi"><b>{fmt(slow["lat"]["p99"], 0)} ms</b><span>worst p99 ({html.escape(slow["endpoint"])} c={slow["conns"]})</span></div></div>')

    if first:
        o.append("<h2>Cold start</h2><p>This run was a cold test: no warm-up, and a fresh server for each endpoint. The amber bar is the very first request a new server answered (JIT compiling, building the EF model, opening the database). The green mark is the typical request time afterwards. The gap is the price of a cold start.</p>")
        o.append(f'<div class="card">{first_chart(first, runs)}</div>')
    o.append("<h2>Failures and timeouts</h2><p>Each bar is one run, split by what happened to the requests. Green is good. Amber is an HTTP error answer. Red is a request that timed out or never connected. Grey requests were still in flight when the timer ended; oha counts those as aborted, but they are not failures. A bar with no red or amber means the API never failed.</p>")
    o.append(f'<div class="card">{outcome_chart(runs)}</div>')
    problems = [r for r in runs if r["non2xx"] or r["failed"]]
    if problems:
        o.append("<h3>Runs with failures</h3><div class='card scroll'><table><tr><th>run</th><th>status codes</th><th>errors</th></tr>")
        for r in problems:
            o.append(f"<tr><td>{html.escape(r['endpoint'])} c={r['conns']}</td><td>{html.escape(', '.join(f'{k}: {v:,}' for k, v in sorted(r['codes'].items())))}</td><td>{html.escape(', '.join(f'{k}: {v:,}' for k, v in r['errors'].items()) or '-')}</td></tr>")
        o.append("</table></div>")
    else:
        o.append("<p class='good'>No failures in any run: every request that completed returned 2xx, and none timed out.</p>")

    o.append("<h2>Throughput and latency by concurrency</h2><p>Look for the knee: where requests/sec stops rising and latency starts climbing, the API is saturated and extra connections only queue.</p><div class='charts'>")
    by = lambda f: {e: {r["conns"]: f(r) for r in runs if r["endpoint"] == e} for e in endpoints}
    o.append(line_chart("Requests per second", "higher is better", by(lambda r: r["rps"]), conns, "req/s", logy=True))
    o.append(line_chart("p99 latency (ms)", "lower is better", by(lambda r: r["lat"]["p99"]), conns, "ms", logy=True))
    o.append(line_chart("Error-free share (%)", "success rate of completed requests", by(lambda r: r["success"]), conns, "%"))
    o.append("</div>")

    o.append("<h2>Per endpoint</h2>")
    for e in endpoints:
        er = [r for r in runs if r["endpoint"] == e]
        o.append(f"<h3>{html.escape(e)}</h3><div class='charts'>")
        o.append(line_chart("Latency percentiles (ms)", e, {p: {r["conns"]: r["lat"][p] for r in er} for p in ("p50", "p90", "p95", "p99", "p99.9")}, [r["conns"] for r in er], "ms", logy=True))
        o.append(line_chart("Fastest / mean / slowest (ms)", e, {"min": {r["conns"]: r["min"] for r in er}, "mean": {r["conns"]: r["mean"] for r in er}, "max": {r["conns"]: r["max"] for r in er}}, [r["conns"] for r in er], "ms", logy=True))
        o.append("</div><div class='hists'>" + "".join(hist_chart(r) for r in er) + "</div>")

    heads = [("Endpoint", None), ("Conns", None), ("Requests", None), ("2xx", None), ("Non-2xx", None), ("Failed", None), ("Cut off", None), ("Success %", None), ("Req/s", None), ("Min", None), ("Mean", None),
             *[(p, None) for p in PCTS], ("Max", None), ("TTFB p50", None), ("TTFB p99", None), ("Connect avg", None), ("B/req", None), ("KB/s", None)]
    o.append("<h2>All numbers</h2><p>Latencies in milliseconds. TTFB is time to first byte. Connect avg is the time to open the connection (DNS plus TCP). Failed is timeouts and connection errors. Cut off is requests still running when the timer ended.</p>")
    o.append("<div class='card scroll'><table><tr>" + "".join(f"<th>{h}</th>" for h, _ in heads) + "</tr>")
    prev = None
    for r in runs:
        cls = ' class="sep"' if prev and prev != r["endpoint"] else ""
        prev = r["endpoint"]
        cell = lambda v, d=1, bad=False: f'<td class="{"bad" if bad and v else ""}">{fmt(v, d)}</td>'
        o.append(f"<tr{cls}><td>{html.escape(r['endpoint'])}</td><td>{r['conns']}</td>" + cell(r["total"], 0) + cell(r["ok"], 0) + cell(r["non2xx"], 0, True) + cell(r["failed"], 0, True) + cell(r["aborted"], 0)
                 + cell(r["success"], 2) + cell(r["rps"]) + cell(r["min"], 2) + cell(r["mean"], 2) + "".join(cell(r["lat"][p], 2) for p in PCTS) + cell(r["max"], 2)
                 + cell(r["ttfb50"], 2) + cell(r["ttfb99"], 2) + cell(r["dial_ms"], 3) + cell(r["bytes_req"], 0) + cell(r["kb_s"], 0) + "</tr>")
    o.append("</table></div></main></body></html>")
    return "".join(o)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    folder = args[0]
    runs = load(folder)
    if not runs:
        sys.exit(f"No <endpoint>-c<N>.json files found in {folder}")
    out = os.path.join(folder, "report.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(build(runs, folder))
    write_csv(runs, os.path.join(folder, "summary-detailed.csv"))
    print(f"Report: {out}")
    print(f"CSV:    {os.path.join(folder, 'summary-detailed.csv')}")
    if "--open" in sys.argv and hasattr(os, "startfile"):
        os.startfile(out)


if __name__ == "__main__":
    main()
