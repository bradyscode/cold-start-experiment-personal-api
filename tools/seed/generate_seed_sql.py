#!/usr/bin/env python3
"""Generate seed.sql: demo data for every tracker in the Personal API database.

Usage:
  python tools/seed/generate_seed_sql.py --apply          # write seed.sql AND load it into the database (recommended)
  python tools/seed/generate_seed_sql.py                  # only write seed.sql (nothing is loaded; use --apply or run the file yourself)
  python tools/seed/generate_seed_sql.py [--out personal-api/data/seed.sql] [--db personal-api/data/personal-api.db] [--days 120] [--seed 42] [--no-backup]

--apply first makes a consistent backup copy next to the database (personal-api.db.bak-<time>), then runs the SQL. The API may stay running.

What the generated file does (details are in its header):
  1. Deletes rows no version of the app can read (non-GUID ids, dates before 1900).
  2. Creates the 15 extra custom trackers if they are missing, and repairs their definitions if they are in the old unreadable form.
  3. Inserts demo records (Source = 'seed') for the 46 built-in trackers and the 15 extra ones.

Dates in the SQL are relative to the day you RUN it (today = the run day), so the dashboards always show recent data.
Rows are idempotent: each has a stable ExternalId, so running the file twice adds nothing the second time.
Standard library only; the output is deterministic for a given --seed and --days.
"""
import argparse
import datetime as dt
import json
import math
import os
import random
import sqlite3
import sys

ap = argparse.ArgumentParser()
ap.add_argument("--out", default="personal-api/data/seed.sql")
ap.add_argument("--days", type=int, default=120)
ap.add_argument("--seed", type=int, default=42)
ap.add_argument("--apply", action="store_true", help="also load the generated SQL into the database")
ap.add_argument("--db", default="personal-api/data/personal-api.db")
ap.add_argument("--no-backup", action="store_true", help="with --apply: skip the backup copy")
args = ap.parse_args()

rng = random.Random(args.seed)
DAYS = args.days
TODAY = dt.date.today()
rows = []  # (kind, day_offset, seconds_after_midnight_utc, value, data)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def wd(day):
    return (TODAY.weekday() + day) % 7  # Monday = 0; day is 0 for today and negative for the past


def add(kind, day, local_hour, data, value=None, minute=None):
    # Local hours 6-17 map to 12:00-23:59 UTC, so the UTC day equals the US local day.
    hour = int(clamp(local_hour, 6, 17))
    minute = rng.randrange(60) if minute is None else minute
    rows.append((kind, day, (hour + 6) * 3600 + minute * 60 + rng.randrange(60), value, data))


def r1(x):
    return round(x, 1)


def stars():
    return clamp(round(rng.gauss(3.8, 0.7) * 2) / 2, 1, 5)


def pick(seq):
    return rng.choice(seq)


def chance(p):
    return rng.random() < p


def weighted(options):
    return rng.choices([o for o, _ in options], weights=[w for _, w in options])[0]


REPOS = ["personal-api", "personal-web", "dotfiles"]
COMMIT_MESSAGES = [
    "Fix off-by-one in weekly bucket", "Add category filter chips", "Tighten number validation", "Refactor feed rule helpers",
    "Handle empty series in chart", "Add tests for lag sign", "Update README", "Bump pinned dependencies", "Speed up overview query",
    "Fix focus ring on tiles", "Add compare URL state", "Clean up unused styles", "Guard against zero variance", "Improve error copy",
    "Extract number formatter", "Add seed script", "Fix time zone label", "Handle 404 for unknown tracker", "Polish mobile layout", "Add load test notes",
]
BOOKS = ["The Dispossessed", "Shop Class as Soulcraft", "Project Hail Mary", "The Pragmatic Programmer", "Educated", "Range", "Dune"]
AUTHORS = ["Ursula K. Le Guin", "Matthew Crawford", "Andy Weir", "Andrew Hunt", "Tara Westover", "David Epstein", "Frank Herbert"]
NOTES = ["Remember to oil the planer tables", "Try a lower tire pressure next ride", "Ideas for the shop layout", "Call about the fence quote",
         "Look into a second cutting board design", "Order more 9mm for the range", "Back up the photos", "Plan the weekend hike"]
JOURNAL = [("Long focus block and a good run", "Shipped the dashboard fixes"), ("Slow morning, productive afternoon", "Finished the shaker side table"),
           ("Range day with a clean group", "Best group of the month"), ("Rainy day, caught up on reading", "Finished a chapter early"),
           ("Busy with reviews", "Cleared the review queue"), ("Quiet weekend at home", "Fixed the garage shelf")]

# ---- latent daily state: everything below is driven by these so trackers correlate the way real life does ----
state = {"rest": 0.0, "weight": 182.0, "caff_prev": 200.0, "alcohol_prev": 0.0}
days = list(range(-(DAYS - 1), 1))
daily = {}  # per-day facts reused by custom trackers (steps, commits, stress, meals...)

for day in days:
    i = day + DAYS - 1  # 0 = oldest
    w = wd(day)
    weekend = w >= 5
    workday = not weekend
    state["rest"] = 0.5 * state["rest"] + rng.gauss(0, 0.9)
    rest = state["rest"]
    act = chance(0.58 if w in (0, 2, 4, 5) else 0.22)
    work = rng.gauss(0, 1) + (1.0 if workday else -1.2)

    commits = 0
    if workday and chance(0.92):
        commits = int(clamp(round(rng.gauss(5.5, 2.8) + 0.8 * work), 0, 16))
    elif weekend and chance(0.4):
        commits = rng.randint(1, 4)
    tokens = 0.0
    if commits > 0:
        tokens = commits * rng.uniform(120_000, 380_000) + rng.uniform(0, 80_000)
    elif chance(0.2):
        tokens = rng.uniform(20_000, 150_000)

    stress = clamp(40 + 7 * work - 8 * rest + rng.gauss(0, 6), 6, 95)
    caffeine = int(clamp(round((150 + 45 * work + (40 if workday else 0) + rng.gauss(0, 30)) / 5) * 5, 0, 480))
    sleep_h = clamp(7.1 + 0.65 * rest + (0.45 if weekend else 0) - 0.0035 * (state["caff_prev"] - 200) - 0.1 * state["alcohol_prev"] + rng.gauss(0, 0.25), 4.6, 9.6)
    sleep_h = r1(sleep_h)
    sleep_score = int(clamp(round(72 + 9 * (sleep_h - 7) + 3 * rest + rng.gauss(0, 3)), 35, 100))
    mood = int(clamp(round(3.0 + 0.55 * (sleep_h - 7) + (0.35 if act else 0) - 0.02 * (stress - 40) + rng.gauss(0, 0.55)), 1, 5))
    energy = int(clamp(round(3.0 + 0.5 * (sleep_h - 7) + (0.4 if act else 0) - 0.003 * (state["caff_prev"] - 200) + rng.gauss(0, 0.55)), 1, 5))
    hrv = int(clamp(round(52 + 7 * rest - 0.1 * (stress - 40) + rng.gauss(0, 4)), 20, 110))
    rhr_base = 61 - 4 * i / max(1, DAYS - 1)
    rhr = int(clamp(round(rhr_base - 1.3 * rest + (0.9 if state["alcohol_prev"] > 0 else 0) + rng.gauss(0, 1.2)), 44, 80))
    battery = int(clamp(round(55 + 14 * rest + 8 * (sleep_h - 7) - (10 if stress > 60 else 0) + rng.gauss(0, 6)), 5, 100))
    steps = int(clamp(round(6200 + 3600 * (1 if act else 0) + (1200 if weekend else 0) + rng.gauss(0, 900)), 1500, 22000))
    active = int(clamp(round(25 + 45 * (1 if act else 0) + rng.gauss(0, 10)), 5, 180))
    state["weight"] += -0.02 + rng.gauss(0, 0.28)
    water = int(clamp(round(60 + 18 * (1 if act else 0) + rng.gauss(0, 10)), 24, 140))
    drinks = 0.0
    if chance(0.45 if w in (4, 5) else 0.08):
        drinks = pick([0.5, 1, 1, 2, 2, 3, 4])
    screen = r1(clamp(4.2 + 0.4 * work - 0.15 * (sleep_h - 7) + rng.gauss(0, 0.6), 1.5, 9))
    state["caff_prev"], state["alcohol_prev"] = caffeine, drinks

    # --- health ---
    add("sleep", day, 6, {"hours": sleep_h, "score": sleep_score}, sleep_h, 10)
    add("mood", day, 16, {"rating": mood}, mood)
    add("energy", day, 12, {"rating": energy}, energy)
    add("hrv", day, 6, {"hrv_ms": hrv}, hrv, 20)
    add("resting_hr", day, 6, {"bpm": rhr}, rhr, 25)
    add("body_battery", day, 7, {"level": battery}, battery)
    add("stress", day, 15, {"level": int(round(stress))}, int(round(stress)))
    add("steps", day, 17, {"steps": steps}, steps, 55)
    add("active_minutes", day, 17, {"minutes": active}, active, 50)
    add("water", day, 17, {"ounces": water}, water, 45)
    add("caffeine", day, 9, {"caffeine_mg": caffeine}, caffeine)
    add("screen_time", day, 17, {"hours": screen}, screen, 40)
    if chance(0.8):
        reading = r1(state["weight"] + rng.gauss(0, 0.35))
        add("weight", day, 6, {"weight": reading}, reading, 40)
    if drinks > 0:
        add("alcohol", day, 17, {"drinks": drinks}, drinks, 20)
    if chance(0.4):
        m = pick([10, 12, 15, 20, 25])
        add("meditation", day, 7, {"minutes": m}, m)
    if w == 2:
        sys_bp = int(clamp(round(116 + 0.12 * (stress - 40) + rng.gauss(0, 3.5)), 98, 150))
        dia_bp = int(clamp(round(75 + 0.07 * (stress - 40) + rng.gauss(0, 2.5)), 55, 98))
        add("blood_pressure", day, 8, {"systolic": sys_bp, "diastolic": dia_bp, "pulse": rhr + rng.randint(4, 10)}, sys_bp)
    if w == 6:
        v = r1(44 + 0.012 * i * 5 + rng.gauss(0, 0.5))
        add("vo2max", day, 9, {"vo2max": v}, v)

    meals = []
    for hour, meal, base in ((7, "breakfast", 470), (12, "lunch", 670), (17, "dinner", 820)):
        kcal = int(clamp(round(base + (60 if act else 0) + rng.gauss(0, 70)), 250, 1400))
        meals.append(kcal)
        add("nutrition", day, hour, {"calories": kcal, "protein_g": int(kcal * 0.25 / 4 * rng.uniform(0.9, 1.15)), "carbs_g": int(kcal * 0.45 / 4 * rng.uniform(0.9, 1.1)),
                                     "fat_g": int(kcal * 0.30 / 9 * rng.uniform(0.9, 1.15)), "meal": meal}, kcal, 10)
    if chance(0.5):
        kcal = int(clamp(round(rng.gauss(200, 60)), 80, 450))
        meals.append(kcal)
        add("nutrition", day, 15, {"calories": kcal, "meal": "snack"}, kcal, 30)

    # --- fitness ---
    if act:
        wtype = pick(["Lift", "Row", "Yoga", "Circuit", "Lift"])
        dur = int(clamp(round(rng.gauss(52, 12)), 25, 95))
        add("workout", day, 11, {"type": wtype, "duration_min": dur, "rpe": int(clamp(round(rng.gauss(7, 1)), 4, 10)), "location": pick(["Home gym", "Gym"])}, dur, 30)
    if w in (1, 3, 6) and chance(0.6):
        dist = r1(clamp(rng.gauss(4.0, 1.3), 1.5, 9))
        add("run", day, 7, {"distance_mi": dist, "duration_min": int(dist * rng.uniform(8.8, 11.2)), "avg_hr": int(clamp(round(rng.gauss(150, 6)), 120, 185))}, dist, 15)
    if weekend and chance(0.12):
        dist = r1(rng.uniform(3, 9))
        add("hike", day, 9, {"distance_mi": dist, "elevation_ft": rng.randint(300, 2000), "duration_min": int(dist * rng.uniform(25, 38))}, dist, 5)
    if weekend and chance(0.12):
        dist = r1(rng.uniform(10, 28))
        add("bike_ride", day, 8, {"distance_mi": dist, "duration_min": int(dist * rng.uniform(4.5, 6.0))}, dist, 20)

    # --- code ---
    for _ in range(commits):
        add("github_commit", day, rng.randint(8, 17), {"repo": weighted([("personal-api", 45), ("personal-web", 45), ("dotfiles", 10)]), "message": pick(COMMIT_MESSAGES),
                                                      "additions": int(clamp(round(math.exp(rng.gauss(3.6, 1.0))), 1, 900)), "deletions": int(clamp(round(math.exp(rng.gauss(2.6, 1.1))), 0, 400))})
    for _ in range(min(3, commits)):
        if chance(0.7):
            add("github_actions_run", day, rng.randint(8, 17), {"repo": pick(REPOS[:2]), "workflow": pick(["CI", "CI", "Deploy"]),
                                                               "status": weighted([("success", 86), ("failure", 10), ("cancelled", 4)]), "duration_s": rng.randint(55, 540)})
    if workday and chance(0.45):
        add("pull_request", day, rng.randint(9, 16), {"repo": pick(REPOS[:2]), "title": pick(COMMIT_MESSAGES), "state": pick(["opened", "merged", "merged"])})
    if tokens > 0:
        parts = [tokens] if chance(0.55) else [tokens * 0.6, tokens * 0.4]
        for part in parts:
            total = int(part)
            inp, out, cread = int(total * 0.10), int(total * 0.07), int(total * 0.70)
            add("claude_usage", day, 17, {"total_tokens": total, "input_tokens": inp, "output_tokens": out, "cache_read_tokens": cread,
                                          "cache_write_tokens": total - inp - out - cread, "messages": total // 25000 + 1, "cost_usd": round(total / 1e6 * 5.5, 2),
                                          "model": weighted([("claude-opus-5-5", 45), ("claude-sonnet-5-5", 55)]), "project": pick(["personal-api", "personal-web"])}, total, 55)
    if commits > 0 or (workday and chance(0.3)):
        hours = r1(clamp(0.55 * commits + rng.gauss(1.0, 0.8), 0.5, 9))
        add("coding_session", day, 10, {"hours": hours, "project": pick(REPOS[:2])}, hours, 0)

    # --- hobbies ---
    if weekend and chance(0.6):
        hours = r1(clamp(rng.gauss(3.2, 1.2), 1, 7))
        add("shop_session", day, 10, {"hours": hours, "project": pick(["Walnut side table", "Workbench vise", "Shaker bookcase", "Cutting boards"]), "tools": "table saw, router"}, hours)
    if w == 5 and chance(0.55):
        score = int(clamp(round(88 - 2.5 * (sleep_h - 7) + rng.gauss(0, 3.5)), 72, 112))
        add("golf_round", day, 8, {"course": pick(["Pine Ridge", "Lakeview", "Cedar Hollow"]), "tees": pick(["white", "blue"]), "holes": 18, "par": 72, "score": score,
                                   "putts": int(clamp(round(rng.gauss(33, 2)), 26, 40)), "fairways_hit": int(clamp(round(rng.gauss(7, 2)), 2, 13)), "fairways_total": 14,
                                   "gir": int(clamp(round(rng.gauss(6, 2)), 0, 13)), "penalties": int(max(0, round(rng.gauss(1.2, 1)))), "weather": pick(["sunny", "windy", "overcast", "hot"]),
                                   "rating": clamp(round((3.6 - 0.05 * (score - 85) + rng.gauss(0, 0.5)) * 2) / 2, 1, 5), "cost": rng.randint(55, 95)}, score)
    if w == 2 and chance(0.35):
        balls = pick([60, 72, 80, 96, 100, 120])
        add("golf_range_session", day, 16, {"balls": balls, "focus": pick(["Driver", "Irons", "Wedges", "Putting"]), "duration_min": rng.randint(35, 75), "cost": rng.randint(12, 20), "rating": stars()}, balls)
    if chance(0.07):
        add("tool_maintenance", day, 11, {"tool": pick(["Table saw", "Chisels", "Hand plane", "Router", "Drill press"]), "task": pick(["sharpen", "clean", "oil", "calibrate", "replace blade", "repair"]),
                                          "minutes": rng.randint(10, 60), "cost": rng.randint(0, 25)})
    if chance(0.06):
        hours = r1(rng.uniform(1, 6))
        add("home_project", day, 10, {"project": pick(["Fence repair", "Garage shelves", "Deck stain"]), "hours": hours, "cost": rng.randint(10, 180)}, hours)

    # --- reading, media, money, life ---
    if chance(0.7):
        minutes = int(clamp(round(rng.gauss(32, 14)), 8, 90))
        add("reading_session", day, 17, {"minutes": minutes, "pages": int(minutes * rng.uniform(0.7, 1.2)), "title": pick(BOOKS)}, minutes, 5)
    if chance(0.45):
        data = {"type": pick(["movie", "show", "game", "podcast", "album"]), "title": pick(["Severance", "Dune: Part Two", "Hades", "The Daily", "Kind of Blue", "Andor", "Outer Wilds"]),
                "status": pick(["started", "finished", "finished", "dropped"]), "year": rng.randint(1985, 2025)}
        if chance(0.7):
            data["rating"] = stars()
        add("media_log", day, 17, data)
    if chance(0.25):
        amount = r1(clamp(math.exp(rng.gauss(3.6, 0.9)), 6, 400))
        cat = pick(["tools", "guns and ammo", "lumber", "electronics", "home", "food", "other"])
        data = {"item": pick(["Router bits", "Hearing protection", "Walnut boards", "Bench dog set", "USB-C hub", "Chisel set", "Cleaning kit", "Paint"]), "amount": amount, "category": cat, "vendor": pick(["Amazon", "Home Depot", "Rockler", "Local shop"])}
        if chance(0.3):
            data["warranty_until"] = (TODAY + dt.timedelta(days=day + rng.randint(365, 1095))).isoformat()
        add("purchase", day, 14, data, amount)
    if chance(0.85):
        amount = r1(clamp(math.exp(rng.gauss(3.1, 0.8)) + (10 if weekend else 0), 3, 160))
        data = {"amount": amount, "category": pick(["food", "food", "transport", "fun", "bills", "health", "other"])}
        if chance(0.3):
            data["note"] = pick(["Lunch out", "Gas", "Coffee", "Groceries", "Parking"])
        add("expense", day, 13, data, amount)
    if chance(0.3):
        add("note", day, 16, {"text": pick(NOTES)})
    if chance(0.45):
        text, highlight = pick(JOURNAL)
        add("journal", day, 17, {"text": text, "highlight": highlight}, minute=45)
    for habit in ("Stretch", "Read 20 pages", "Walk after lunch"):
        if chance(0.85):
            add("habit", day, 17, {"habit": habit, "done": chance(0.62 + (0.1 if act else 0))})

    daily[day] = {"commits": commits, "steps": steps, "stress": stress, "workday": workday, "act": act, "meals": sum(meals), "rhr": rhr, "i": i}

# ---- scheduled hobby events (days ago) ----
range_trips = [3, 15, 27, 39, 52, 64, 77, 89, 101, 113]
for ago in range_trips:
    day = -(ago + rng.randint(-1, 1))
    if day < -(DAYS - 1) or day > 0:
        continue
    caliber, firearm, cpr = pick([("9mm", "Glock 19", 0.28), ("9mm", "Glock 19", 0.28), (".22 LR", "Ruger 10/22", 0.07), ("5.56 NATO", "AR-15", 0.42)])
    rounds = pick([100, 125, 150, 150, 200, 250])
    add("range_session", day, 11, {"rounds": rounds, "caliber": caliber, "firearms": firearm, "cost": round(rounds * cpr, 2), "best_group_in": r1(rng.uniform(1.1, 3.2)),
                                   "distance_yds": pick([7, 10, 15, 25, 50]), "duration_min": rng.randint(45, 95), "rating": stars()}, rounds)
    if day + 1 <= 0:
        add("gun_cleaning", day + 1, 9, {"firearm": firearm, "rounds_since_last": rounds, "minutes": rng.randint(20, 40)})
for ago in (20, 50, 82, 110):
    if -ago >= -(DAYS - 1):
        loaded = rng.randint(150, 300)
        add("reloading_session", -ago, 10, {"rounds_loaded": loaded, "caliber": "9mm", "powder": "Titegroup 4.0 gr", "cost": rng.randint(35, 70)}, loaded)
for ago in (35, 66, 98):
    if -ago >= -(DAYS - 1):
        rounds = pick([500, 1000])
        add("ammo_purchase", -ago, 14, {"rounds": rounds, "caliber": "9mm", "cost": int(rounds * rng.uniform(0.2, 0.3)), "vendor": pick(["Local shop", "Online"])}, rounds)
for ago, name in ((14, "Walnut side table"), (47, "Cutting board set"), (90, "Workbench vise")):
    if -ago >= -(DAYS - 1):
        hours = r1(rng.uniform(8, 26))
        add("project_finished", -ago, 16, {"name": name, "hours": hours, "cost": rng.randint(40, 220), "wood": pick(["Walnut", "Maple", "Oak"])}, hours)
for ago, author, pages in ((6, 0, 336), (28, 1, 256), (51, 2, 476), (74, 3, 352), (99, 4, 334)):
    if -ago >= -(DAYS - 1):
        add("book_finished", -ago, 17, {"author": AUTHORS[author], "pages": pages, "rating": stars()}, pages)
for ago, dest, nights in ((78, "Austin", 4), (33, "Asheville", 3)):
    if -ago >= -(DAYS - 1):
        add("travel", -ago, 12, {"destination": dest, "nights": nights, "purpose": pick(["leisure", "family"]), "cost": rng.randint(450, 1400), "companions": "Family"}, nights)

# ---- the 15 extra custom trackers (definitions repaired below) ----
for day in days:
    d = daily[day]
    w, i = wd(day), d["i"]
    for hour in (8, 11, 15):
        percent = r1(clamp(18 + 4 * d["commits"] + (12 if d["workday"] else 0) + rng.gauss(0, 9), 3, 97))
        add("cpu_usage", day, hour, {"percent": percent, "host": "homelab-01"}, percent)
        used = int(clamp(round(3400 + 70 * d["commits"] + rng.gauss(0, 350)), 1500, 7600))
        add("memory_usage", day, hour, {"used_mb": used, "total_mb": 8192}, used)
    disk = r1(52 + 0.075 * i + rng.gauss(0, 0.4))
    add("disk_usage", day, 6, {"percent": disk, "mount": "/"}, disk, 5)
    for _ in range(4):
        latency = r1(clamp(math.exp(rng.gauss(4.3, 0.55)), 5, 1500))
        add("api_request", day, rng.randint(7, 17), {"endpoint": pick(["/records", "/feed", "/series", "/analytics/overview"]),
                                                    "status_code": weighted([(200, 95), (400, 3), (500, 2)]), "latency_ms": latency}, latency)
    for _ in range(int(d["commits"] * 0.5)):
        add("build", day, rng.randint(8, 17), {"repository": pick(REPOS[:2]), "status": weighted([("success", 82), ("failed", 14), ("cancelled", 4)]), "duration_seconds": int(clamp(round(rng.gauss(210, 70)), 40, 900))})
    if w in (1, 3) and chance(0.5):
        add("deployment", day, rng.randint(10, 16), {"service": pick(["personal-api", "personal-web"]), "environment": weighted([("production", 40), ("staging", 60)]),
                                                    "status": weighted([("success", 90), ("failed", 5), ("rolled_back", 5)])})
    for _ in range(int(clamp(round(rng.gauss(0.8 + 0.15 * d["commits"], 0.9)), 0, 4))):
        add("error", day, rng.randint(7, 17), {"service": pick(["api", "web", "worker"]), "severity": weighted([("low", 60), ("medium", 30), ("high", 10)]),
                                              "message": pick(["Timeout calling upstream", "Unhandled null reference", "Slow query warning", "Cache miss storm"])})
    for _ in range(rng.randint(3, 6) if d["workday"] else rng.randint(0, 1)):
        add("task", day, rng.randint(8, 17), {"task": pick(["Review PR", "Write tests", "Update docs", "Triage bugs", "Plan sprint", "Refactor feed rules"]),
                                             "status": weighted([("done", 70), ("todo", 20), ("blocked", 10)])})
    if d["workday"]:
        for _ in range(rng.randint(1, 3)):
            minutes = int(clamp(round(rng.gauss(52, 18)), 15, 120))
            add("focus", day, rng.randint(8, 16), {"minutes": minutes, "project": pick(REPOS[:2])}, minutes)
    km = r1(clamp(d["steps"] / 1312 + rng.gauss(0, 0.4), 0.5, 20))
    add("distance", day, 17, {"distance": km}, km, 58)
    kcal = int(round(d["meals"] + rng.gauss(0, 40)))
    add("calories", day, 17, {"calories": kcal}, kcal, 59)
    for hour in (7, 10, 13, 16):
        bpm = int(clamp(round(d["rhr"] + rng.uniform(8, 45)), 45, 180))
        add("heart_rate", day, hour, {"bpm": bpm}, bpm)
    temp = r1(27 - 0.12 * i + rng.gauss(0, 2.5))
    add("temperature", day, 12, {"temperature": temp}, temp, 0)
    if chance(0.5):
        pages = int(clamp(round(rng.gauss(28, 12)), 4, 80))
        add("reading", day, 17, {"pages": pages, "book": pick(BOOKS)}, pages)
for ago in (79, 79, 78):
    if -ago >= -(DAYS - 1):
        minutes = rng.randint(38, 52)
        add("scuba_dive", -ago, 10 + rng.randint(0, 3), {"duration_minutes": minutes, "max_depth_m": r1(rng.uniform(12, 24)), "site": pick(["Turtle Point", "Blue Hole", "Coral Garden"])}, minutes)

# ---- definitions of the 15 custom trackers, written the way the app stores them ----


def field(name, ftype, label, required=False, options=None, lo=None, hi=None, integer=False):
    return {"Name": name, "Type": ftype, "Required": required, "Label": label, "Options": options, "Min": lo, "Max": hi, "Integer": integer}


CUSTOM_KINDS = {
    "api_request": ([field("endpoint", "Text", "Endpoint"), field("status_code", "Number", "Status code", lo=100, hi=599, integer=True), field("latency_ms", "Number", "Latency (ms)", lo=0)], "latency_ms", "Systems", "avg", "lower"),
    "build": ([field("repository", "Text", "Repository"), field("status", "Choice", "Result", options=["success", "failed", "cancelled"]), field("duration_seconds", "Number", "Duration (seconds)", lo=0)], None, "Systems", "count", "none"),
    "calories": ([field("calories", "Number", "Calories", required=True, lo=0)], "calories", "Health", "sum", "none"),
    "cpu_usage": ([field("percent", "Number", "CPU (percent)", lo=0, hi=100), field("host", "Text", "Host")], "percent", "Systems", "avg", "lower"),
    "deployment": ([field("service", "Text", "Service"), field("environment", "Choice", "Environment", options=["production", "staging"]), field("status", "Choice", "Result", options=["success", "failed", "rolled_back"])], None, "Systems", "count", "none"),
    "disk_usage": ([field("percent", "Number", "Disk used (percent)", lo=0, hi=100), field("mount", "Text", "Mount")], "percent", "Systems", "avg", "lower"),
    "distance": ([field("distance", "Number", "Distance (km)", required=True, lo=0)], "distance", "Fitness", "sum", "higher"),
    "error": ([field("service", "Text", "Service"), field("severity", "Choice", "Severity", options=["low", "medium", "high"]), field("message", "Text", "Message")], None, "Systems", "count", "lower"),
    "focus": ([field("minutes", "Number", "Minutes", lo=0, hi=1440), field("project", "Text", "Project")], "minutes", "Code", "sum", "higher"),
    "heart_rate": ([field("bpm", "Number", "Beats per minute", required=True, lo=20, hi=250, integer=True)], "bpm", "Health", "avg", "none"),
    "memory_usage": ([field("used_mb", "Number", "Used (MB)", lo=0), field("total_mb", "Number", "Total (MB)", lo=0)], "used_mb", "Systems", "avg", "lower"),
    "reading": ([field("pages", "Number", "Pages", lo=0, integer=True), field("book", "Text", "Book")], "pages", "Reading and media", "sum", "higher"),
    "scuba_dive": ([field("duration_minutes", "Number", "Duration (minutes)", lo=0, hi=1440), field("max_depth_m", "Number", "Max depth (m)", lo=0, hi=200), field("site", "Text", "Dive site")], "duration_minutes", "Hobbies", "sum", "none"),
    "task": ([field("task", "Text", "Task"), field("status", "Choice", "Status", options=["todo", "done", "blocked"])], None, "Life", "count", "none"),
    "temperature": ([field("temperature", "Number", "Temperature (C)", required=True, lo=-90, hi=60)], "temperature", "Life", "avg", "none"),
}


CUSTOM_META = {  # key: (display name, default unit)
    "api_request": ("API request", "ms"), "build": ("Build", "count"), "calories": ("Calories", "kcal"), "cpu_usage": ("CPU usage", "%"),
    "deployment": ("Deployment", "count"), "disk_usage": ("Disk usage", "%"), "distance": ("Distance", "km"), "error": ("Error", "count"),
    "focus": ("Focus", "minutes"), "heart_rate": ("Heart rate", "bpm"), "memory_usage": ("Memory usage", "MB"), "reading": ("Reading", "pages"),
    "scuba_dive": ("Scuba dive", "minutes"), "task": ("Task", "count"), "temperature": ("Temperature", "\u00b0C"),
}


def sql_text(value):
    return "'" + value.replace("'", "''") + "'"


def sql_value(value):
    if value is None:
        return "NULL"
    return repr(float(value)) if isinstance(value, float) else str(value)


GUID_GLOB = "-".join("".join(["[0-9A-Fa-f]"] * n) for n in (8, 4, 4, 4, 12))
YEAR_1900_TICKS = 599266080000000000
TICKS_AT_UNIX_EPOCH = 621355968000000000

counts = {}
for kind, *_ in rows:
    counts[kind] = counts.get(kind, 0) + 1

out = []
out.append(f"""-- seed.sql: demo data for the Personal API database.
-- Generated by tools/seed/generate_seed_sql.py (--seed {args.seed} --days {DAYS}). Re-run the generator to regenerate this file.
--
-- WHAT IT DOES
--   Step 1  Deletes rows that no version of the app can read: ids that are not GUIDs, or dates before 1900
--           (an earlier seed stored Unix seconds where the app expects .NET ticks, which crashes GET /records and /analytics/overview).
--   Step 2  Creates the 15 extra custom trackers (api_request, build, calories, cpu_usage, deployment, disk_usage, distance, error,
--           focus, heart_rate, memory_usage, reading, scuba_dive, task, temperature) if they do not exist, and repairs their field
--           definitions when they are stored in the old unreadable form. They get a category and a default aggregation.
--   Step 3  Inserts {len(rows)} demo records across {len(counts)} trackers, all with Source = 'seed'. Dates are relative to the day you run
--           this file (today = the run day), so the dashboards always show recent data. Every row has a stable ExternalId,
--           so running the file again inserts nothing new.
--
-- HOW TO RUN (the database is personal-api/data/personal-api.db). Easiest, from the repo root, with a backup made for you:
--   python tools/seed/generate_seed_sql.py --apply        (this file only WRITES the SQL; --apply is what loads it)
-- Or run this file yourself (stop the API first if your tool complains the database is locked):
--   sqlite3:         sqlite3 personal-api/data/personal-api.db ".read personal-api/data/seed.sql"
--   DB Browser:      open the .db file, Execute SQL tab, open this file, run all (then Write Changes)
--   Python (no CLI): python -c "import sqlite3; c=sqlite3.connect('personal-api/data/personal-api.db'); c.executescript(open('personal-api/data/seed.sql',encoding='utf-8').read()); c.commit()"
--   Start the API once BEFORE seeding so it has created the 46 built-in trackers (this file inserts records only).
--
-- REMOVE THE DEMO DATA AGAIN:  DELETE FROM Records WHERE Source = 'seed';
--
-- Time columns are .NET ticks: (unix seconds * 10000000) + {TICKS_AT_UNIX_EPOCH}. Dates before 1900 are below {YEAR_1900_TICKS}.

-- ===== Step 1: delete rows the app cannot read =====
DELETE FROM Records
WHERE OccurredAt < {YEAR_1900_TICKS}
   OR Id NOT GLOB '{GUID_GLOB}';

-- ===== Step 2: create the extra custom trackers if missing, then repair any still in the old unreadable form =====""")

for key, (fields, value_field, category, agg, better) in CUSTOM_KINDS.items():
    display, unit = CUSTOM_META[key]
    out.append(f"INSERT OR IGNORE INTO Kinds (Key, DisplayName, DefaultUnit, Fields, ValueField, Category, DefaultAgg, Better) VALUES ({sql_text(key)}, {sql_text(display)}, {sql_text(unit)}, "
               f"{sql_text(json.dumps(fields, separators=(',', ':')))}, {sql_text(value_field) if value_field else 'NULL'}, {sql_text(category)}, {sql_text(agg)}, {sql_text(better)});")
for key, (fields, value_field, category, agg, better) in CUSTOM_KINDS.items():
    out.append(f"UPDATE Kinds SET Fields = {sql_text(json.dumps(fields, separators=(',', ':')))}, ValueField = {sql_text(value_field) if value_field else 'NULL'}, "
               f"Category = COALESCE(Category, {sql_text(category)}), DefaultAgg = COALESCE(DefaultAgg, {sql_text(agg)}), Better = COALESCE(Better, {sql_text(better)}) "
               f"WHERE Key = {sql_text(key)} AND Fields GLOB '*\"name\":*';")

out.append("\n-- ===== Step 3: demo records =====")
by_kind = {}
for row in rows:
    by_kind.setdefault(row[0], []).append(row)

BATCH = 250
for kind in sorted(by_kind):
    items = by_kind[kind]
    out.append(f"\n-- {kind}: {len(items)} records")
    for start in range(0, len(items), BATCH):
        chunk = items[start:start + BATCH]
        tuples = ",\n".join(f"({sql_text(kind)},{start + n + 1},{day},{sec},{sql_value(value)},{sql_text(json.dumps(data, separators=(',', ':')))})"
                            for n, (_, day, sec, value, data) in enumerate(chunk))
        out.append(f"""WITH base(midnight, now_s) AS (SELECT CAST(strftime('%s','now','start of day') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
v(kind, n, day, sec, val, data) AS (VALUES
{tuples}
)
INSERT OR IGNORE INTO Records (Id, Source, Kind, OccurredAt, Value, Unit, Title, DataJson, ExternalId, CreatedAt)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89AB', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       'seed', v.kind,
       ((MIN(b.midnight + v.day * 86400 + v.sec, b.now_s - 60)) * 10000000) + {TICKS_AT_UNIX_EPOCH},
       v.val, k.DefaultUnit,
       COALESCE(k.DisplayName, v.kind) || ' ' || strftime('%Y-%m-%d', MIN(b.midnight + v.day * 86400 + v.sec, b.now_s - 60), 'unixepoch'),
       v.data, 'seed-' || v.kind || '-' || v.n,
       (b.now_s * 10000000) + {TICKS_AT_UNIX_EPOCH}
FROM v CROSS JOIN base b LEFT JOIN Kinds k ON k.Key = v.kind;""")

out.append("""
-- ===== Checks (read-only) =====
-- Demo records per tracker:
SELECT Kind, COUNT(*) AS records FROM Records WHERE Source = 'seed' GROUP BY Kind ORDER BY Kind;
-- Trackers that have demo records but do not exist yet (should return no rows; start the API once, then run this file again):
SELECT DISTINCT Kind AS missing_tracker FROM Records WHERE Source = 'seed' AND Kind NOT IN (SELECT Key FROM Kinds);
-- Unreadable rows still left (should be 0):
SELECT COUNT(*) AS unreadable_rows FROM Records WHERE OccurredAt < """ + str(YEAR_1900_TICKS) + """ OR Id NOT GLOB '""" + GUID_GLOB + """';""")

path = args.out
sql_text_out = "\n".join(out) + "\n"
with open(path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(sql_text_out)
print(f"wrote {path}: {len(rows)} records, {len(counts)} trackers, {len(CUSTOM_KINDS)} custom definitions")

if not args.apply:
    print("NOTE: this only wrote the SQL file. The database was NOT changed, so the app still has no data.")
    print("      Load it now with:  python tools/seed/generate_seed_sql.py --apply")
    sys.exit(0)

if not os.path.exists(args.db):
    sys.exit(f"Database not found at {args.db}. Start the API once so it creates the database, then run this again.")
try:
    if not args.no_backup:
        backup = f"{args.db}.bak-{dt.datetime.now():%Y%m%d-%H%M%S}"
        src = sqlite3.connect(f"file:{os.path.abspath(args.db).replace(os.sep, '/')}?mode=ro", uri=True, timeout=30)
        dst = sqlite3.connect(backup)
        src.backup(dst)
        dst.close()
        src.close()
        print(f"backup written: {backup}")
    conn = sqlite3.connect(args.db, timeout=30)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if not {"Records", "Kinds"} <= tables:
        sys.exit("The database has no Records/Kinds tables yet. Start the API once so it creates them, then run this again.")
    conn.executescript(sql_text_out)
    conn.commit()
    seeded = conn.execute("SELECT COUNT(*) FROM Records WHERE Source = 'seed'").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM Records").fetchone()[0]
    kinds = conn.execute("SELECT COUNT(*) FROM Kinds").fetchone()[0]
    missing = [r[0] for r in conn.execute("SELECT DISTINCT Kind FROM Records WHERE Source = 'seed' AND Kind NOT IN (SELECT Key FROM Kinds)")]
    unreadable = conn.execute(f"SELECT COUNT(*) FROM Records WHERE OccurredAt < {YEAR_1900_TICKS}").fetchone()[0]
    conn.close()
except sqlite3.OperationalError as error:
    sys.exit(f"Could not write to the database ({error}). If it says locked, stop the API (end the Visual Studio debug session) and run this again.")
print(f"applied: {seeded} demo records ({total} records in total, {kinds} trackers, {unreadable} unreadable rows left)")
if missing:
    print(f"WARNING: demo records exist for trackers that are not in the database: {', '.join(missing)}. Start the API once, then run this again.")
else:
    print("done. Refresh the app: the feed, dashboards and Compare view now have data.")
