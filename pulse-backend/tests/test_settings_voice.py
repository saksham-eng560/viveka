"""Settings tab API, the coach honouring settings, and Leo's voice."""
from __future__ import annotations

import random
from typing import Any

import pytest
from fastapi.testclient import TestClient

import coach as coach_mod
import voice as voice_mod
from activity_store import ActivityStore
from coach import PACES, Coach, DesktopSample
from config import get_settings
from persona import Brain
from profile_store import ProfileIn, ProfileStore, LeoSettings
from tests.test_buddy_api import PROFILE
from tests.test_coach import Clock, chrome_on, run, vscode

DEMO = PACES["demo"]


# ------------------------------------------------------------------- settings API
def test_settings_need_a_profile(client: TestClient) -> None:
    assert client.get("/api/settings").status_code == 409
    assert client.put("/api/settings", json={"pace": "demo"}).status_code == 409


def test_settings_roundtrip_and_onboarding_keeps_them(client: TestClient) -> None:
    client.put("/api/profile", json=PROFILE)
    s = client.get("/api/settings").json()
    assert s["settings"]["voice"]["voice"] == "af_heart" and s["settings"]["personality"] == "playful"
    assert s["effective"] == s["presets"]["demo"] and s["effective"]["headsup"] == 2
    assert set(s["presets"]) == {"gentle", "balanced", "demo"}
    assert "engine" in s["voiceEngine"]

    new = s["settings"]
    new["timings"]["headsup"] = 5
    new["detectors"]["hopping"] = False
    new["voice"].update({"voice": "am_puck", "speed": 1.1, "pitch": 10, "speak": "everything"})
    new["personality"] = "coach"
    r = client.put("/api/settings", json={"settings": new, "quotes": "off", "voice": True, "sounds": False})
    assert r.status_code == 200
    out = r.json()
    assert out["effective"]["headsup"] == 5 and out["effective"]["distraction"] == DEMO.distraction
    assert out["settings"]["detectors"]["hopping"] is False and out["quotes"] == "off"
    assert out["voice"] is True and out["sounds"] is False

    # editing goals in onboarding must not wipe Settings
    client.put("/api/profile", json={**PROFILE, "goals": ["Ship my portfolio"]})
    again = client.get("/api/settings").json()
    assert again["settings"]["voice"]["voice"] == "am_puck" and again["settings"]["timings"]["headsup"] == 5

    # buddy state exposes what the page needs for voice and the hover label
    brief = client.get("/api/buddy/state").json()["profile"]
    assert brief["voiceSettings"]["pitch"] == 10 and brief["showStatusChip"] is True


def test_settings_validation_and_overrides(client: TestClient) -> None:
    client.put("/api/profile", json=PROFILE)
    s = client.get("/api/settings").json()["settings"]
    bad = {**s, "voice": {**s["voice"], "speed": 5}}
    assert client.put("/api/settings", json={"settings": bad}).status_code == 422
    assert client.put("/api/settings", json={"pace": "turbo"}).status_code == 422
    r = client.put("/api/settings", json={"overrides": {"web:youtube.com": "focus", "junk": "focus"}}).json()
    assert r["overrides"] == {"web:youtube.com": "focus"}
    assert client.put("/api/settings", json={"overrides": {}}).json()["overrides"] == {}


def test_clear_history(client: TestClient) -> None:
    client.put("/api/profile", json=PROFILE)
    c = coach_mod.get_coach()
    c.ingest_desktop(DesktopSample(app="Code", bundle_id="com.microsoft.VSCode", title="a.py", key_idle=1))
    c.tick()
    c._close_segment(c.clock() + 5)
    assert c.store.segments_between(0, 1e12)
    assert client.delete("/api/history").json() == {"ok": True}
    assert not c.store.segments_between(0, 1e12)
    assert client.get("/api/profile").json()["exists"] is True  # profile kept


# -------------------------------------------------------------- coach honours them
def coach_with(tmp_path: Any, clock: Clock, **settings: Any) -> Coach:
    gs = get_settings()
    profiles = ProfileStore(tmp_path / "s")
    profiles.save(ProfileIn(name="Saksham", goals=["Crack DSA"], work_tools=["vscode"], distractions=["instagram", "youtube"],
                            pace="demo", quotes=settings.pop("quotes", "sometimes")))
    if settings:
        base = LeoSettings().model_dump()
        for k, v in settings.items():
            base[k] = {**base[k], **v} if isinstance(v, dict) else v
        profiles.update(settings=base)
    c = Coach(gs, profiles, ActivityStore(tmp_path / "s"), Brain(gs), clock=clock, rng=random.Random(3))
    c.greeted = True
    return c


@pytest.fixture
def clock() -> Clock:
    return Clock()


def test_timing_override_applies_on_top_of_preset(tmp_path: Any, clock: Clock) -> None:
    c = coach_with(tmp_path, clock, timings={"headsup": 6})
    assert c.pace.headsup == 6 and c.pace.distraction == DEMO.distraction
    run(c, clock, 4, desktop=chrome_on("Reels • Instagram - Google Chrome"))
    assert not [m for m in c.messages if m.kind == "nudge"]
    run(c, clock, 3, desktop=chrome_on("Reels • Instagram - Google Chrome"))
    assert [m.kind for m in c.messages if m.kind == "nudge"] == ["nudge"]


def test_detector_switches(tmp_path: Any, clock: Clock) -> None:
    c = coach_with(tmp_path, clock, detectors={"headsup": False, "detour": False, "stall": False})
    run(c, clock, DEMO.distraction * 3, desktop=chrome_on("Reels • Instagram - Google Chrome"))
    assert not [m for m in c.messages if m.kind in ("nudge", "distraction")]
    d = vscode()
    run(c, clock, 20, desktop=d, typing_until=clock.t + 20)
    run(c, clock, DEMO.stall * 4, desktop=d)
    assert not [m for m in c.messages if m.kind == "stall"]


def test_quotes_off_silences_ambient_wisdom(tmp_path: Any, clock: Clock) -> None:
    c = coach_with(tmp_path, clock, quotes="off")
    d = DesktopSample(app="Finder", bundle_id="com.apple.finder", title="Desktop", key_idle=30, input_idle=1)
    run(c, clock, DEMO.wisdom_gap * 3, desktop=d)
    assert not [m for m in c.messages if m.kind in ("quote", "fact")]


def test_ai_switch_off_keeps_everything_rule_based(tmp_path: Any, clock: Clock) -> None:
    import dataclasses

    c = coach_with(tmp_path, clock, use_ai=False)
    c.settings = dataclasses.replace(c.settings, llm_classify=True)
    assert c.ai_enabled is False
    run(c, clock, 3, desktop=chrome_on("Funny cats - YouTube - Google Chrome"))
    assert [m.title for m in c.messages if m.kind == "nudge"] == ["Wrong tab?"]  # no waiting for a model


def test_messages_carry_speech_and_prefetch_when_voice_on(tmp_path: Any, clock: Clock) -> None:
    class FakeVoice:
        def __init__(self) -> None:
            self.calls: list[tuple[list[str], str, float]] = []

        def prefetch(self, chunks: list[str], voice: str, speed: float) -> None:
            self.calls.append((chunks, voice, speed))

    c = coach_with(tmp_path, clock, voice={"voice": "am_puck", "pitch": 10, "speed": 1.1})
    c.voice = FakeVoice()  # type: ignore[assignment]
    run(c, clock, 3, desktop=chrome_on("Reels • Instagram - Google Chrome"))
    nudge = next(m for m in c.messages if m.kind == "nudge")
    assert nudge.speech and nudge.speech[0].startswith("Wrong tab?")
    assert c.voice.calls == []  # speaking out loud is off by default
    c.profiles.update(voice=True)
    c.action("quote")  # quotes are not "important": not pre-rendered by default
    c.action("poke")
    assert len(c.voice.calls) == 1 and c.voice.calls[0][1:] == ("am_puck", 1.0)


# ------------------------------------------------------------------------- voice
def test_speech_text_and_chunks() -> None:
    from voice import effective_speed, speech_chunks, speech_text

    t = speech_text("nudge", "Wrong tab?", "Hmm, Instagram? Not right for 'Crack DSA', Saksham... Shall we go back? 🌿")
    assert t == "Wrong tab? Hmm, Instagram? Not right for 'Crack D S A', Saksham, Shall we go back?"
    assert speech_chunks("Hi. This is a much longer sentence that keeps going. Done!") == [
        "Hi. This is a much longer sentence that keeps going.", "Done!"]
    assert speech_text("quote", "Swamiji says", "Arise, awake.") == "Swamiji says: Arise, awake."
    assert effective_speed(1.0, 0) == 1.0 and effective_speed(1.0, 25) == 0.8 and effective_speed(9, 0) == 2.0


def test_voice_status_without_neural_model(tmp_path: Any) -> None:
    v = voice_mod.Voice(tmp_path / "no-models")
    st = v.status()
    assert st["neuralInstalled"] is False and st["engine"] in ("system", "none")
    assert [x["id"] for x in st["voices"]] == ["system"]
    v.shutdown()


def test_say_endpoint_uses_saved_settings_and_caches(client: TestClient, tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, float]] = []

    class FakeVoice(voice_mod.Voice):
        def engine(self) -> str:
            return "neural"

        def _render(self, text: str, voice: str, speed: float) -> bytes:
            calls.append((text, voice, speed))
            return b"RIFF-fake-wav"

    fake = FakeVoice(tmp_path)
    voice_mod.reset_voice(fake)
    try:
        client.put("/api/profile", json=PROFILE)
        r = client.post("/api/voice/say", json={"text": "Wrong tab?"})
        assert r.status_code == 200 and r.headers["content-type"] == "audio/wav" and r.content == b"RIFF-fake-wav"
        client.post("/api/voice/say", json={"text": "Wrong tab?"})
        assert calls == [("Wrong tab?", "af_heart", voice_mod.effective_speed(1.0, 6.0))]  # second one cached
        client.post("/api/voice/say", json={"text": "Preview", "voice": "am_puck", "speed": 1.2, "pitch": 0})
        assert calls[-1] == ("Preview", "am_puck", 1.2)
        client.post("/api/voice/say", json={"text": "Sneaky", "voice": "../../etc"})
        assert calls[-1][1] == "af_heart"  # unknown/unsafe voice names fall back
    finally:
        voice_mod.reset_voice(None)


def test_say_endpoint_503_when_no_engine(client: TestClient, tmp_path: Any) -> None:
    class Mute(voice_mod.Voice):
        def engine(self) -> str:
            return "none"

    voice_mod.reset_voice(Mute(tmp_path))
    try:
        assert client.post("/api/voice/say", json={"text": "hello"}).status_code == 503
    finally:
        voice_mod.reset_voice(None)


def test_legacy_db_name_is_migrated(tmp_path: Any) -> None:
    (tmp_path / "lighthouse.db").write_bytes(b"")
    store = ActivityStore(tmp_path)
    assert store.path.name == "viveka.db" and store.path.exists() and not (tmp_path / "lighthouse.db").exists()


def test_env_aliases(env: Any, tmp_path: Any) -> None:
    import config

    env(VIVEKA_DATA_DIR=str(tmp_path / "new"))
    assert config.get_settings().data_dir == str(tmp_path / "new")


def test_previous_db_name_is_migrated_too(tmp_path: Any) -> None:
    (tmp_path / "sheru.db").write_bytes(b"")
    store = ActivityStore(tmp_path)
    assert store.path.name == "viveka.db" and store.path.exists() and not (tmp_path / "sheru.db").exists()


def test_older_env_names_still_work(env: Any, tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    import config

    monkeypatch.delenv("VIVEKA_DATA_DIR", raising=False)
    env(SHERU_DATA_DIR=str(tmp_path / "sheru-era"))
    assert config.get_settings().data_dir == str(tmp_path / "sheru-era")
    monkeypatch.delenv("SHERU_DATA_DIR")
    env(LIGHTHOUSE_DATA_DIR=str(tmp_path / "lighthouse-era"))
    assert config.get_settings().data_dir == str(tmp_path / "lighthouse-era")
