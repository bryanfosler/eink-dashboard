import os
import re
import subprocess
import requests
from datetime import datetime, date, timedelta
from urllib.parse import quote
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

load_dotenv(override=True)

ENV_FILE = os.path.join(os.path.dirname(__file__), ".env")

app = Flask(__name__)

WEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
WEATHER_CITY = os.getenv("OPENWEATHER_CITY", "Madison,WI,US")
WEATHER_UNITS = os.getenv("OPENWEATHER_UNITS", "imperial")
VAULT_NAME = "ObsidianVault"

OBSIDIAN_VAULT = os.path.expanduser(
    "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/ObsidianVault"
)

TRAINING_PLAN_FILE = os.path.join(OBSIDIAN_VAULT, "AI Knowledge/Training/Eugene Training Plan.md")
RACE_DATE = date(2026, 4, 26)
PLAN_START = date(2026, 1, 5)

STRAVA_CLIENT_ID     = os.getenv("STRAVA_CLIENT_ID", "")
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET", "")
STRAVA_REFRESH_TOKEN = os.getenv("STRAVA_REFRESH_TOKEN", "")


def get_weather():
    if not WEATHER_API_KEY:
        return {"error": "No API key"}
    try:
        url = f"https://api.openweathermap.org/data/2.5/weather?q={WEATHER_CITY}&appid={WEATHER_API_KEY}&units={WEATHER_UNITS}"
        r = requests.get(url, timeout=5)
        d = r.json()
        return {
            "temp": round(d["main"]["temp"]),
            "feels_like": round(d["main"]["feels_like"]),
            "description": d["weather"][0]["description"].title(),
            "icon": d["weather"][0]["icon"],
            "humidity": d["main"]["humidity"],
            "wind": round(d["wind"]["speed"]),
            "city": d["name"],
        }
    except Exception as e:
        return {"error": str(e)}


def get_obsidian_tasks():
    """Read all unchecked tasks from Obsidian vault, with file path and line number for editing."""
    tasks = []
    try:
        for root, dirs, files in os.walk(OBSIDIAN_VAULT):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for fname in files:
                if not fname.endswith(".md"):
                    continue
                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, OBSIDIAN_VAULT)
                try:
                    with open(full_path, "r", encoding="utf-8") as f:
                        for line_num, line in enumerate(f, 1):
                            if "- [ ]" in line:
                                text = line.strip().replace("- [ ]", "").strip()
                                if text:
                                    tasks.append({
                                        "text": text,
                                        "file": fname.replace(".md", ""),
                                        "path": full_path,
                                        "rel_path": rel_path,
                                        "line": line_num,
                                    })
                except Exception:
                    continue
    except Exception as e:
        tasks = [{"text": f"Error reading vault: {e}", "file": "", "path": "", "rel_path": "", "line": 0}]
    return tasks


DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

def get_training_data():
    """Parse Eugene Training Plan for current week and today's workout."""
    today = date.today()
    days_since_start = (today - PLAN_START).days
    week_num = days_since_start // 7 + 1
    day_of_week = today.weekday()  # 0=Mon, 6=Sun
    days_to_race = (RACE_DATE - today).days

    result = {
        "week": week_num,
        "today_workout": None,
        "today_label": DAY_NAMES[day_of_week],
        "week_plan": [],
        "week_total": None,
        "days_to_race": days_to_race,
        "race_date": RACE_DATE.strftime("%B %-d"),
        "phase": get_phase(week_num),
    }

    try:
        with open(TRAINING_PLAN_FILE, "r", encoding="utf-8") as f:
            content = f.read()

        # Find the table row for current week
        # Format: | 12 | Mar 23-29 | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Total |
        rows = re.findall(r"^\|\s*(\d+)\s*\|(.+)$", content, re.MULTILINE)
        for row in rows:
            if int(row[0]) == week_num:
                cells = [c.strip() for c in row[1].split("|")]
                # cells: [dates, mon, tue, wed, thu, fri, sat, sun, total]
                if len(cells) >= 9:
                    result["week_plan"] = [
                        {"day": DAY_NAMES[i], "workout": cells[i+1], "today": i == day_of_week}
                        for i in range(7) if i+1 < len(cells)
                    ]
                    result["today_workout"] = cells[day_of_week + 1] if day_of_week + 1 < len(cells) else "—"
                    result["week_total"] = cells[8] if len(cells) > 8 else "?"
                break
    except Exception as e:
        result["error"] = str(e)

    return result


def get_phase(week):
    if week <= 6:   return "Base Building"
    if week <= 8:   return "Maintenance"
    if week <= 13:  return "Peak"
    if week <= 15:  return "Taper"
    return "Race Week"


# In-memory token cache: {access_token, expires_at}
_strava_token_cache = {"token": None, "expires_at": 0}

def strava_access_token():
    """Return a valid Strava access token, using cache or refreshing as needed.
    Also saves the new refresh token back to .env so it stays in sync with Piper."""
    now = datetime.now().timestamp()
    if _strava_token_cache["token"] and now < _strava_token_cache["expires_at"] - 60:
        return _strava_token_cache["token"]

    # Read current refresh token fresh from .env each time (Piper may have rotated it)
    load_dotenv(ENV_FILE, override=True)
    refresh_token = os.getenv("STRAVA_REFRESH_TOKEN", "")

    res = requests.post("https://www.strava.com/oauth/token", data={
        "client_id":     os.getenv("STRAVA_CLIENT_ID", STRAVA_CLIENT_ID),
        "client_secret": os.getenv("STRAVA_CLIENT_SECRET", STRAVA_CLIENT_SECRET),
        "refresh_token": refresh_token,
        "grant_type":    "refresh_token",
    }, timeout=8)
    data = res.json()

    access_token  = data.get("access_token")
    new_refresh   = data.get("refresh_token")
    expires_at    = data.get("expires_at", now + 21600)

    if not access_token:
        raise ValueError(f"Strava token error: {data}")

    # Cache the access token
    _strava_token_cache["token"]      = access_token
    _strava_token_cache["expires_at"] = expires_at

    # Save rotated refresh token back to .env so Piper and dashboard stay in sync
    if new_refresh and new_refresh != refresh_token:
        try:
            with open(ENV_FILE, "r") as f:
                content = f.read()
            import re as _re
            content = _re.sub(r"STRAVA_REFRESH_TOKEN=.*", f"STRAVA_REFRESH_TOKEN={new_refresh}", content)
            with open(ENV_FILE, "w") as f:
                f.write(content)
        except Exception:
            pass

    return access_token


def strava_configured():
    return all([STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN])


ACTIVITY_KIND = {
    "Run": "run", "VirtualRun": "run",
    "Ride": "bike", "VirtualRide": "bike", "EBikeRide": "bike",
    "WeightTraining": "strength", "Workout": "strength", "Crossfit": "strength",
    "Walk": "walk", "Hike": "walk",
}

def fmt_pace(secs_per_mile):
    m = int(secs_per_mile // 60)
    s = int(secs_per_mile % 60)
    return f"{m}:{s:02d}"

def fmt_duration(secs):
    if secs >= 3600:
        return f"{secs//3600}h {(secs%3600)//60}m"
    return f"{secs//60}m"

def parse_activity(a):
    dist_m   = a.get("distance", 0)
    dist_mi  = round(dist_m / 1609.34, 2)
    secs     = a.get("moving_time", 0)
    pace_sec = secs / (dist_m / 1609.34) if dist_m > 0 else 0
    atype    = a.get("type", "Workout")
    return {
        "name":     a.get("name", atype),
        "date":     a["start_date_local"][:10],
        "miles":    dist_mi,
        "pace":     fmt_pace(pace_sec) if dist_m > 0 else None,
        "pace_sec": pace_sec,
        "duration": fmt_duration(secs),
        "secs":     secs,
        "hr":       round(a["average_heartrate"]) if a.get("average_heartrate") else None,
        "type":     atype,
        "kind":     ACTIVITY_KIND.get(atype, "other"),
    }


def aggregate_day(activities):
    """Compute per-kind totals and averages for a list of activities on one day."""
    by_kind = {}
    for a in activities:
        k = a["kind"]
        if k not in by_kind:
            by_kind[k] = {"miles": 0, "secs": 0, "weighted_pace": 0, "hr_sum": 0, "hr_count": 0, "count": 0}
        g = by_kind[k]
        g["miles"]         += a["miles"]
        g["secs"]          += a["secs"]
        g["weighted_pace"] += a["pace_sec"] * a["miles"]  # for weighted avg pace
        if a["hr"]:
            g["hr_sum"]   += a["hr"]
            g["hr_count"] += 1
        g["count"] += 1

    summary = {}
    for k, g in by_kind.items():
        avg_pace_sec = g["weighted_pace"] / g["miles"] if g["miles"] > 0 else 0
        summary[k] = {
            "miles":    round(g["miles"], 1),
            "duration": fmt_duration(g["secs"]),
            "pace":     fmt_pace(avg_pace_sec) if avg_pace_sec > 0 else None,
            "hr":       round(g["hr_sum"] / g["hr_count"]) if g["hr_count"] else None,
            "count":    g["count"],
        }
    return summary


def get_strava_runs(count=5):
    """Fetch recent runs for the dashboard card."""
    if not strava_configured():
        return {"error": "Strava not configured"}
    try:
        token = strava_access_token()
        res = requests.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers={"Authorization": f"Bearer {token}"},
            params={"per_page": count, "page": 1},
            timeout=8,
        )
        activities = res.json()
        if not isinstance(activities, list):
            return {"error": activities.get("message", "Unknown Strava error")}
        runs = [parse_activity(a) for a in activities if a.get("type") in ("Run", "VirtualRun")]
        return {"runs": runs}
    except Exception as e:
        return {"error": str(e)}


def get_strava_month():
    """Fetch all activities in last 30 days. Returns dict of date→list of activities."""
    if not strava_configured():
        return {}, "Strava not configured"
    try:
        after = int((datetime.now() - timedelta(days=30)).timestamp())
        token = strava_access_token()
        res = requests.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers={"Authorization": f"Bearer {token}"},
            params={"per_page": 50, "after": after},
            timeout=10,
        )
        activities = res.json()
        if not isinstance(activities, list):
            return {}, f"Strava error: {activities}"
        by_date = {}
        for a in activities:
            d = a["start_date_local"][:10]
            if d not in by_date:
                by_date[d] = []
            by_date[d].append(parse_activity(a))
        return by_date, None
    except Exception as e:
        return {}, str(e)


def parse_plan_weeks(num_weeks=4):
    """Return last N weeks of the training plan with actual calendar dates."""
    today = date.today()
    current_week = (today - PLAN_START).days // 7 + 1
    start_week   = max(1, current_week - num_weeks + 1)

    plan_rows = {}
    try:
        with open(TRAINING_PLAN_FILE, "r", encoding="utf-8") as f:
            content = f.read()
        for row in re.findall(r"^\|\s*(\d+)\s*\|(.+)$", content, re.MULTILINE):
            wn = int(row[0])
            if start_week <= wn <= current_week:
                cells = [c.strip() for c in row[1].split("|")]
                # cells: [dates, mon, tue, wed, thu, fri, sat, sun, total]
                plan_rows[wn] = cells
    except Exception:
        pass

    weeks = []
    for wn in range(start_week, current_week + 1):
        week_start = PLAN_START + timedelta(days=(wn - 1) * 7)
        cells = plan_rows.get(wn, [])
        days = []
        for i in range(7):
            d = week_start + timedelta(days=i)
            planned = cells[i + 1] if len(cells) > i + 1 else "?"
            days.append({
                "date":    d.isoformat(),
                "day":     DAY_NAMES[i],
                "planned": planned,
                "future":  d > today,
                "today":   d == today,
            })
        weeks.append({
            "week_num": wn,
            "phase":    get_phase(wn),
            "total":    cells[8] if len(cells) > 8 else "?",
            "days":     days,
        })
    return weeks


@app.route("/")
def dashboard():
    weather  = get_weather()
    tasks    = get_obsidian_tasks()
    training = get_training_data()
    strava   = get_strava_runs()
    now      = datetime.now()
    return render_template(
        "dashboard.html",
        weather=weather,
        tasks=tasks,
        training=training,
        strava=strava,
        now=now,
        refresh_mins=30,
    )


@app.route("/api/training-month")
def training_month():
    """Plan vs actual for the last 4 weeks — fetched lazily when modal opens."""
    weeks         = parse_plan_weeks(4)
    actual, error = get_strava_month()
    for week in weeks:
        for day in week["days"]:
            acts = actual.get(day["date"])
            if acts:
                day["activities"] = acts
                day["summary"]    = aggregate_day(acts)
    return jsonify({"weeks": weeks, "strava_error": error})


@app.route("/api/task/complete", methods=["POST"])
def complete_task():
    """Mark a task as done by replacing - [ ] with - [x] at the given line."""
    data = request.json
    path = data.get("path")
    line_num = data.get("line")

    if not path or not line_num:
        return jsonify({"ok": False, "error": "Missing path or line"}), 400
    if not os.path.exists(path):
        return jsonify({"ok": False, "error": "File not found"}), 404

    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        target = lines[line_num - 1]
        if "- [ ]" not in target:
            return jsonify({"ok": False, "error": "Task already completed or not found"}), 400

        lines[line_num - 1] = target.replace("- [ ]", "- [x]", 1)
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)

        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/open-obsidian", methods=["POST"])
def open_obsidian():
    """Open a note in Obsidian on this Mac (works even when called from iPad)."""
    data = request.json
    rel_path = data.get("rel_path", "")
    # Strip .md for Obsidian URI
    note_path = rel_path.replace("\\", "/")
    if note_path.endswith(".md"):
        note_path = note_path[:-3]
    uri = f"obsidian://open?vault={quote(VAULT_NAME)}&file={quote(note_path)}"
    try:
        subprocess.Popen(["open", uri])
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/data")
def api_data():
    return jsonify({
        "weather": get_weather(),
        "tasks": get_obsidian_tasks(),
        "timestamp": datetime.now().isoformat(),
    })


if __name__ == "__main__":
    print("Dashboard running at http://localhost:5001")
    app.run(host="0.0.0.0", port=5001, debug=True)
