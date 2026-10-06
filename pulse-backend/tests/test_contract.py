"""Cross-component contract tests (C2 extension -> backend, C3 backend -> dashboard)."""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

import aw_queries
from models import (
    AwHealth,
    DailySummaryResponse,
    HealthResponse,
    OllamaHealth,
    StandupNotesResponse,
    TimelineEvent,
    TimelineResponse,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_TYPES = ROOT / "dashboard" / "src" / "lib" / "types.ts"

# Shaped exactly like extension buildEvent(): ISO timestamp, duration, LighthouseEventData.
def ext_event(at: str, duration: float, url: str, score: int, category: str, goal="Ship the demo"):
    return {
        "timestamp": at,
        "duration": duration,
        "data": {
            "url": url,
            "title": "T " + url,
            "audible": False,
            "incognito": False,
            "tabCount": 4,
            "goal_active": goal,
            "ai_score": score,
            "ai_category": category,
            "ai_reasoning": "because",
            "ai_source": "llm",
        },
    }


def test_extension_event_flows_through_parse_summary_timeline():
    raw = [
        ext_event("2026-10-06T04:30:00.000Z", 600, "https://github.com/a/b", 90, "Coding"),
        ext_event("2026-10-06T04:40:00.000Z", 300, "https://www.youtube.com/watch?v=1", 10, "entertainment"),
        ext_event("2026-10-06T04:45:00.000Z", 100, "https://github.com/a/c", 70, "Coding"),
    ]
    events = aw_queries.parse_events(raw)
    assert len(events) == 3
    e0 = events[0]
    assert (e0.url, e0.hostname, e0.score, e0.category, e0.reasoning, e0.goal) == (
        "https://github.com/a/b", "github.com", 90, "Coding", "because", "Ship the demo")

    date = dt.date(2026, 10, 6)
    s = aw_queries.compute_summary(events, date, "aw")
    assert s.total_active_seconds == 1000
    assert s.active_seconds == 700
    assert s.distraction_seconds == 300
    assert s.context_switches == 2
    assert s.top_categories == {"Coding": 700, "Entertainment": 300}
    assert s.average_focus_score == round((90 * 600 + 10 * 300 + 70 * 100) / 1000, 1)

    tl = aw_queries.to_timeline(events, "Asia/Kolkata")
    assert [t.score for t in tl] == [90, 10, 70]
    assert tl[0].timestamp == "2026-10-06T10:00:00+05:30"
    assert tl[0].duration_seconds == 600
    assert tl[1].category == "Entertainment"
    assert tl[1].hostname == "www.youtube.com"
    assert tl[0].goal == "Ship the demo"


def test_null_goal_from_extension_becomes_none():
    raw = [ext_event("2026-10-06T04:30:00Z", 60, "https://a.com", 50, "Other", goal=None)]
    raw[0]["data"]["goal_active"] = None
    assert aw_queries.parse_events(raw)[0].goal is None


def test_heartbeat_zero_duration_event_is_dropped():
    # Extension buildEvent() posts duration 0; aw-server merges, but raw zero spans must not count.
    assert aw_queries.parse_events([ext_event("2026-10-06T04:30:00Z", 0, "https://a.com", 50, "x")]) == []


def _ts_interface_keys(name: str) -> list[str]:
    src = DASHBOARD_TYPES.read_text()
    m = re.search(r"export interface %s\s*\{(.*?)\n\}" % name, src, re.S)
    assert m, f"interface {name} missing"
    return re.findall(r"^\s{2}(\w+)\??:", m.group(1), re.M)


def _json_keys(model_cls, **kw) -> list[str]:
    return list(json.loads(model_cls(**kw).model_dump_json(by_alias=True)).keys())


def test_summary_keys_match_dashboard_types():
    m = DailySummaryResponse(date="2026-10-06", total_active_seconds=1, active_seconds=1, distraction_seconds=0,
                             average_focus_score=1.0, top_categories={}, context_switches=0, source="aw")
    assert sorted(json.loads(m.model_dump_json(by_alias=True))) == sorted(_ts_interface_keys("DailySummaryResponse"))


def test_timeline_event_keys_match_dashboard_types():
    m = TimelineEvent(timestamp="x", duration_seconds=1, url="u", hostname="h", title="t", score=1,
                      category="c", reasoning="r")
    assert sorted(json.loads(m.model_dump_json(by_alias=True))) == sorted(_ts_interface_keys("TimelineEvent"))


def test_timeline_response_keys_match_dashboard_types():
    m = TimelineResponse(date="d", source="aw", events=[])
    assert sorted(json.loads(m.model_dump_json(by_alias=True))) == sorted(_ts_interface_keys("TimelineResponse"))


def test_standup_keys_match_dashboard_types():
    m = StandupNotesResponse(markdown="x", generated_by="template", source="sample")
    assert sorted(json.loads(m.model_dump_json(by_alias=True))) == sorted(_ts_interface_keys("StandupNotesResponse"))


def test_health_keys_match_dashboard_types():
    m = HealthResponse(data_source="auto", aw=AwHealth(reachable=False, url="u"),
                       ollama=OllamaHealth(reachable=False, url="u", model="m", model_available=False))
    d = json.loads(m.model_dump_json(by_alias=True))
    assert sorted(d) == sorted(_ts_interface_keys("HealthResponse"))
    src = DASHBOARD_TYPES.read_text()
    assert all(k in src for k in d["ollama"])  # modelAvailable etc. present in TS type
