"""Coach engine scenarios, driven by a fake clock (demo pace: fast thresholds)."""
from __future__ import annotations

import random
from typing import Any

import pytest

from activity_store import ActivityStore
from coach import PACES, BrowserSample, Coach, DesktopSample
from config import get_settings
from persona import Brain
from profile_store import ProfileIn, ProfileStore

DEMO = PACES["demo"]


class Clock:
    def __init__(self) -> None:
        self.t = 1_800_000_000.0

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def clock() -> Clock:
    return Clock()


def make_coach(tmp_path: Any, clock: Clock, pace: str = "demo", **profile: Any) -> Coach:
    settings = get_settings()
    profiles = ProfileStore(tmp_path / "d")
    fields = {"name": "Saksham Verma", "age": 21, "goals": ["Crack DSA for placements"],
              "work_tools": ["vscode", "dsa", "google-docs"], "distractions": ["instagram", "youtube"],
              "pace": pace, **profile}
    profiles.save(ProfileIn(**fields))
    c = Coach(settings, profiles, ActivityStore(tmp_path / "d"), Brain(settings), clock=clock,
              rng=random.Random(7))
    c.greeted = True  # skip the hello messages so assertions see only detector output
    return c


def run(c: Coach, clock: Clock, seconds: float, *, desktop: DesktopSample | None = None,
        typing_until: float | None = None, step: float = 1.0) -> None:
    """Advance time, feeding a desktop sample every step. key_idle grows unless typing."""
    end = clock.t + seconds
    while clock.t < end:
        clock.t += step
        if desktop is not None:
            if typing_until is not None and clock.t <= typing_until:
                desktop.key_idle = 0.5
            else:
                desktop.key_idle += step
            desktop.input_idle = min(desktop.input_idle + step, desktop.key_idle) if desktop.key_idle < 2 else 1.0
            c.ingest_desktop(desktop)
        c.tick()


def kinds(c: Coach) -> list[tuple[str, int]]:
    return [(m.kind, m.level) for m in c.messages]


def vscode(**kw: Any) -> DesktopSample:
    return DesktopSample(app="Code", bundle_id="com.microsoft.VSCode", title="graph.py — dsa", **kw)


def test_stall_two_nudges_then_distracted(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    d = vscode()
    run(c, clock, 20, desktop=d, typing_until=clock.t + 20)  # typing for a while
    assert [k for k in kinds(c) if k[0] == "stall"] == []
    run(c, clock, DEMO.stall + 1, desktop=d)
    assert ("stall", 1) in kinds(c)
    assert any(m.kind == "quote" for m in c.messages), "first stall nudge comes with a Vivekananda quote"
    run(c, clock, DEMO.stall, desktop=d)
    assert ("stall", 2) in kinds(c)
    run(c, clock, DEMO.stall, desktop=d)
    third = [m for m in c.messages if m.kind == "stall" and m.level == 3]
    assert third and third[0].title == "You seem distracted" and third[0].ttl is None
    assert c.active_alert == third[0].id
    assert c.mood(clock.t) == "worried"
    # no fourth nudge however long the silence lasts
    run(c, clock, DEMO.stall * 3, desktop=d)
    assert sum(1 for k in kinds(c) if k[0] == "stall") == 3
    # typing again clears the alert and cheers
    run(c, clock, 2, desktop=d, typing_until=clock.t + 2)
    assert c.messages[-1].kind == "back" and c.active_alert is None and c.stall_level == 0


def test_no_stall_nudges_in_non_writing_app(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    d = DesktopSample(app="Finder", bundle_id="com.apple.finder", title="Downloads")
    run(c, clock, 5, desktop=d, typing_until=clock.t + 5)
    run(c, clock, DEMO.stall * 4, desktop=d)
    assert not [k for k in kinds(c) if k[0] == "stall"]


def test_distraction_escalates_and_return_celebrates(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    chrome = DesktopSample(app="Google Chrome", bundle_id="com.google.Chrome", title="Instagram - Google Chrome",
                           key_idle=30, input_idle=1)
    c.ingest_browser(BrowserSample(url="https://www.instagram.com/reels/", title="Instagram"))
    run(c, clock, DEMO.distraction - 2, desktop=chrome)
    assert not [m for m in c.messages if m.kind == "distraction"]
    run(c, clock, 3, desktop=chrome)
    first = [m for m in c.messages if m.kind == "distraction"]
    assert len(first) == 1 and first[0].level == 1 and first[0].label == "Instagram"
    assert {a["id"] for a in first[0].actions} == {"back_to_work", "snooze", "its_work"}
    assert "Instagram" in first[0].text
    c.ingest_browser(BrowserSample(url="https://www.instagram.com/reels/", title="Instagram"))
    run(c, clock, DEMO.repeat + 1, desktop=chrome)
    assert [m.level for m in c.messages if m.kind == "distraction"] == [1, 2]
    # back to the editor: alert cleared, celebration
    run(c, clock, 2, desktop=vscode(key_idle=0.5))
    assert c.active_alert is None and c.messages[-1].kind == "back"


def test_snooze_and_its_work(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    yt = DesktopSample(app="Google Chrome", bundle_id="com.google.Chrome", title="Funny cats - YouTube - Google Chrome",
                       key_idle=40, input_idle=1)
    run(c, clock, DEMO.distraction + 1, desktop=yt)
    alert = c._find(c.active_alert)
    assert alert is not None and alert.label == "YouTube"
    out = c.action("snooze", alert.id)
    assert out["ok"] and c.active_alert is None
    run(c, clock, DEMO.snooze - 2, desktop=yt)
    assert len([m for m in c.messages if m.kind == "distraction"]) == 1
    run(c, clock, DEMO.repeat + 2, desktop=yt)
    assert len([m for m in c.messages if m.kind == "distraction"]) == 2
    c.action("its_work")
    assert c.profile is not None and c.profile.overrides == {"web:youtube.com": "focus"}
    run(c, clock, 2, desktop=yt)
    assert c.verdict is not None and c.verdict.kind == "focus"


def test_away_sleeps_and_welcomes_back(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    d = DesktopSample(app="Instagram", bundle_id="x", title="", key_idle=500, input_idle=DEMO.afk + 5)
    c.ingest_desktop(d)
    c.tick()
    assert c.away and c.mood(clock.t) == "sleep"
    clock.t += 1
    c.ingest_desktop(vscode(key_idle=0.2, input_idle=0.2))
    c.tick()
    assert not c.away and c.messages[-1].text.startswith(("Welcome back", "Oh hi"))


def test_locked_screen_counts_as_away(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    c.ingest_desktop(vscode(locked=True))
    c.tick()
    assert c.away and c.state()["now"] is None


def test_browser_page_merges_into_desktop_context(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    c.ingest_desktop(DesktopSample(app="Google Chrome", bundle_id="com.google.Chrome",
                                   title="Alien Dictionary - DSA Practice | takeUforward - Google Chrome"))
    reply = c.ingest_browser(BrowserSample(url="https://takeuforward.org/plus/dsa/problems/alien-dictionary",
                                           title="Alien Dictionary - DSA Practice | takeUforward"))
    assert reply["verdict"]["kind"] == "focus"
    c.tick()
    assert c.activity is not None and c.activity.domain == "takeuforward.org" and c.verdict.writing
    # a different Chrome window (no extension there): fall back to the window title
    c.ingest_desktop(DesktopSample(app="Google Chrome", bundle_id="com.google.Chrome",
                                   title="Reels - Instagram - Google Chrome"))
    c.tick()
    assert c.activity.domain == "instagram.com" and c.verdict.kind == "distraction"


def test_extension_only_mode_alerts_through_browser_reply(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    for _ in range(DEMO.distraction + 2):
        clock.t += 1
        reply = c.ingest_browser(BrowserSample(url="https://www.instagram.com/", title="Instagram"))
    assert reply["buddyOnline"] is False
    assert reply["alert"] is not None and reply["alert"]["kind"] == "distraction"


def test_back_to_work_targets_last_focus(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    run(c, clock, 3, desktop=vscode(key_idle=0.5))
    out = c.action("back_to_work")
    assert out["activate"] == {"bundleId": "com.microsoft.VSCode"}


def test_ambient_wisdom_when_quiet(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock, quotes="often")
    d = DesktopSample(app="Finder", bundle_id="com.apple.finder", title="Desktop", key_idle=30, input_idle=1)
    run(c, clock, DEMO.wisdom_gap * 0.5 + 35, desktop=d)
    assert any(m.kind in ("quote", "fact") for m in c.messages)


def test_storm_of_switches(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    apps = [("Code", "com.microsoft.VSCode"), ("Slack", "com.tinyspeck.slackmacgap"), ("Notes", "com.apple.Notes")]
    for i in range(DEMO.storm_count + 1):
        name, bid = apps[i % 3]
        clock.t += 2
        c.ingest_desktop(DesktopSample(app=name, bundle_id=bid, title=f"w{i}", key_idle=5, input_idle=1))
        c.tick()
    assert any(m.kind == "storm" for m in c.messages)


def test_break_silences_and_ends(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    c.action("break", minutes=1)
    yt = DesktopSample(app="Google Chrome", bundle_id="com.google.Chrome", title="Netflix - Google Chrome",
                       key_idle=40, input_idle=1)
    run(c, clock, 50, desktop=yt)
    assert c.mood(clock.t) == "break"
    assert not [m for m in c.messages if m.kind == "distraction"]
    run(c, clock, 12, desktop=yt)
    ended = [m for m in c.messages if m.kind == "break" and m.ts > c.messages[0].ts]
    assert ended and ("over" in ended[-1].text.lower() or "done" in ended[-1].text.lower())


def test_segments_logged_for_today(tmp_path: Any, clock: Clock) -> None:
    c = make_coach(tmp_path, clock)
    run(c, clock, 30, desktop=vscode(), typing_until=clock.t + 30)
    run(c, clock, 20, desktop=DesktopSample(app="Google Chrome", bundle_id="com.google.Chrome",
                                            title="Instagram - Google Chrome", key_idle=50, input_idle=1))
    c._close_segment(clock.t)
    stats = c.store.today_stats(clock.t - 3600, clock.t + 1)
    assert 25 <= stats["focusSeconds"] <= 31
    assert 15 <= stats["distractionSeconds"] <= 21
    assert stats["topDistractions"][0]["label"] == "Instagram"
    assert stats["alertCount"] >= 1


def test_no_profile_no_detection(tmp_path: Any, clock: Clock) -> None:
    settings = get_settings()
    c = Coach(settings, ProfileStore(tmp_path / "e"), ActivityStore(tmp_path / "e"), Brain(settings), clock=clock)
    c.ingest_desktop(vscode())
    c.tick()
    assert c.messages[-1].kind == "info"
    assert any(a["id"] == "open_onboarding" for a in c.messages[-1].actions)
    assert c.mood(clock.t) == "wave"
