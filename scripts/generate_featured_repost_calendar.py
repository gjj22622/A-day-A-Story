#!/usr/bin/env python3
"""
Append a curated "featured repost" run after the first 98-story calendar.

Usage:
  python scripts/generate_featured_repost_calendar.py
  python scripts/generate_featured_repost_calendar.py --start 2026-06-16
"""

import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path


CALENDAR_PATH = Path("data/content_calendar.json")
STORIES_PATH = Path("data/stories.json")

WEEKDAYS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]

FEATURED_REPOST_PLAN = [
    ("第一週：過度用力的人，先停一下", ["BDH-001", "BDH-005", "BDH-012", "BDH-051", "BDH-065", "BDH-098", "BDH-070"]),
    ("第二週：卡住的事，從一小步開始", ["BDH-002", "BDH-010", "BDH-022", "BDH-024", "BDH-043", "BDH-044", "BDH-095"]),
    ("第三週：關係裡的委屈與消耗", ["BDH-013", "BDH-027", "BDH-049", "BDH-058", "BDH-067", "BDH-068", "BDH-071"]),
    ("第四週：失去、後悔與放下", ["BDH-006", "BDH-021", "BDH-029", "BDH-037", "BDH-086", "BDH-097", "BDH-089"]),
    ("第五週：職場與人生選擇", ["BDH-018", "BDH-019", "BDH-031", "BDH-055", "BDH-066", "BDH-084", "BDH-085"]),
    ("第六週：看見自己的盲點", ["BDH-035", "BDH-060", "BDH-063", "BDH-064", "BDH-079", "BDH-088", "BDH-092"]),
]


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_date(value):
    return datetime.strptime(value, "%Y-%m-%d").date()


def main():
    parser = argparse.ArgumentParser(description="Append featured repost entries to content_calendar.json")
    parser.add_argument("--start", default="2026-06-16", help="Start date, YYYY-MM-DD")
    args = parser.parse_args()

    start_date = parse_date(args.start)
    total_days = sum(len(ids) for _, ids in FEATURED_REPOST_PLAN)
    end_date = start_date + timedelta(days=total_days - 1)

    calendar = load_json(CALENDAR_PATH)
    stories = {story["id"]: story for story in load_json(STORIES_PATH)}

    entries = []
    day_offset = 0
    for theme, story_ids in FEATURED_REPOST_PLAN:
        for story_id in story_ids:
            story = stories.get(story_id)
            if not story:
                raise SystemExit(f"Story not found: {story_id}")

            current = start_date + timedelta(days=day_offset)
            entries.append({
                "date": current.isoformat(),
                "weekday": WEEKDAYS[current.weekday()],
                "story_id": story_id,
                "story_title": story["title"],
                "story_icon": story.get("icon", ""),
                "platform": "facebook",
                "post_type": "featured_repost",
                "theme": theme,
                "status": "scheduled",
                "post_time_utc": "06:00",
            })
            day_offset += 1

    original = calendar.get("calendar", [])
    filtered = [
        entry for entry in original
        if not (
            entry.get("post_type") == "featured_repost"
            and start_date <= parse_date(entry["date"]) <= end_date
        )
    ]
    calendar["calendar"] = sorted(filtered + entries, key=lambda entry: entry["date"])

    metadata = calendar.setdefault("metadata", {})
    metadata["end_date"] = max(entry["date"] for entry in calendar["calendar"])
    metadata["total_posts"] = len(calendar["calendar"])
    metadata["total_weeks"] = (len(calendar["calendar"]) + 6) // 7
    metadata["featured_repost"] = {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "total_posts": total_days,
        "strategy": "6-week curated rerun for 50+ audience themes",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }

    save_json(CALENDAR_PATH, calendar)
    print(f"Appended {total_days} featured repost entries: {start_date} to {end_date}")


if __name__ == "__main__":
    main()
