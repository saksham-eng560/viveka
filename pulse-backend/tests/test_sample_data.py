import datetime as dt

from aw_queries import compute_summary, to_timeline
from sample_data import GOAL, sample_events

D = dt.date(2026, 10, 6)


def test_deterministic() -> None:
    assert sample_events(D, "UTC") == sample_events(D, "UTC")
    assert sample_events(D, "UTC") != sample_events(dt.date(2026, 10, 7), "UTC")


def test_shape_matches_contract() -> None:
    ev = sample_events(D, "UTC")
    scores = [e.score for e in ev]
    assert min(scores) <= 8 and max(scores) >= 96
    assert all(5 <= s <= 98 for s in scores)
    assert len({e.category for e in ev}) >= 5
    assert {e.goal for e in ev} == {GOAL}
    assert 7 * 3600 <= sum(e.duration for e in ev) <= 9 * 3600
    assert all(a.timestamp < b.timestamp for a, b in zip(ev, ev[1:]))
    assert compute_summary(ev, D, "sample").context_switches >= 15
    hosts = {e.hostname for e in ev}
    assert {"github.com", "vscode.dev", "www.reddit.com", "www.youtube.com"} <= hosts


def test_timeline_in_requested_tz() -> None:
    tl = to_timeline(sample_events(D, "Asia/Kolkata"), "Asia/Kolkata")
    assert tl[0].timestamp.startswith("2026-10-06T09:00:00+05:30")
