"""HTTP surface for onboarding, Sheru and the extension bridge."""
from __future__ import annotations

import datetime as dt

import httpx
import respx
from fastapi.testclient import TestClient

import coach
from catalog import Activity, heuristic_verdict
from tests.conftest import OLLAMA

PROFILE = {
    "name": "Saksham", "age": 21, "goals": ["Crack DSA for placements", "  "], "workTools": ["vscode", "dsa"],
    "distractions": ["instagram", "youtube"], "pace": "demo", "quotes": "often", "voice": False, "sounds": True,
}


def test_profile_roundtrip_and_catalog(client: TestClient) -> None:
    assert client.get("/api/profile").json() == {"exists": False, "profile": None}
    r = client.put("/api/profile", json=PROFILE)
    assert r.status_code == 200
    body = r.json()["profile"]
    assert body["goals"] == ["Crack DSA for placements"] and body["workTools"] == ["vscode", "dsa"]
    assert body["createdAt"] and body["overrides"] == {}
    assert client.get("/api/profile").json()["exists"] is True
    cat = client.get("/api/catalog").json()
    assert {"vscode", "dsa"} <= {c["id"] for c in cat["workTools"]}
    assert "instagram" in {c["id"] for c in cat["distractions"]} and cat["goalIdeas"]


def test_profile_validation(client: TestClient) -> None:
    assert client.put("/api/profile", json={**PROFILE, "name": "   "}).status_code == 422
    assert client.put("/api/profile", json={**PROFILE, "goals": []}).status_code == 422
    assert client.put("/api/profile", json={**PROFILE, "age": 3}).status_code == 422
    assert client.put("/api/profile", json={**PROFILE, "pace": "turbo"}).status_code == 422


def test_saving_profile_greets_and_state_reports(client: TestClient) -> None:
    client.put("/api/profile", json=PROFILE)
    st = client.get("/api/buddy/state").json()
    assert st["profile"]["firstName"] == "Saksham" and st["mood"] in ("idle", "wave")
    greeting = [m for m in st["messages"] if m["kind"] == "greeting"]
    assert greeting and "Saksham" in greeting[0]["text"]
    assert any(m["kind"] == "quote" and "Vivekananda" not in m["text"] for m in st["messages"])
    later = client.get("/api/buddy/state", params={"since": st["lastId"]}).json()
    assert later["messages"] == []


def test_desktop_and_browser_samples(client: TestClient) -> None:
    client.put("/api/profile", json=PROFILE)
    assert client.post("/api/desktop/sample", json={"app": "Google Chrome", "bundleId": "com.google.Chrome",
                                                    "title": "Instagram", "keyIdle": 12, "inputIdle": 1}).json() == {"ok": True}
    r = client.post("/api/browser/sample", json={"url": "https://instagram.com/", "title": "Instagram"}).json()
    assert r["verdict"]["kind"] == "distraction" and r["verdict"]["score"] == 15
    assert r["buddyOnline"] is True and r["commands"] == [] and r["profile"]["goals"]
    coach.get_coach().tick()
    st = client.get("/api/buddy/state").json()
    assert st["now"]["label"] == "Instagram" and st["buddyOnline"] and st["extensionOnline"]


def test_actions(client: TestClient) -> None:
    client.put("/api/profile", json=PROFILE)
    q = client.post("/api/buddy/action", json={"action": "quote"}).json()
    assert q["ok"] and q["message"]["kind"] == "quote" and q["message"]["source"].startswith("Complete Works")
    f = client.post("/api/buddy/action", json={"action": "fact"}).json()
    assert f["message"]["kind"] == "fact"
    b = client.post("/api/buddy/action", json={"action": "break", "minutes": 5}).json()
    assert "5 minutes" in b["message"]["text"]
    assert client.post("/api/buddy/action", json={"action": "nope"}).json()["ok"] is False
    assert client.get("/api/buddy/state").json()["mood"] == "break"


@respx.mock
def test_chat_uses_local_model_and_falls_back(client: TestClient) -> None:
    client.put("/api/profile", json=PROFILE)
    respx.get(f"{OLLAMA}/api/tags").mock(return_value=httpx.Response(200, json={"models": [{"name": "sheru:latest"}]}))
    route = respx.post(f"{OLLAMA}/api/generate").mock(
        return_value=httpx.Response(200, json={"response": "Sheru: You can do it, Saksham! 🦁"}))
    r = client.post("/api/buddy/chat", json={"text": "I feel lazy"}).json()
    assert r["reply"] == "You can do it, Saksham! 🦁"
    sent = route.calls.last.request.read().decode()
    assert '"model":"sheru"' in sent.replace(" ", "") and "Crack DSA" in sent
    route.mock(side_effect=httpx.ConnectError("down"))
    assert client.post("/api/buddy/chat", json={"text": "hello"}).json()["reply"]
    assert "Vivekananda" in client.post("/api/buddy/chat", json={"text": "quote"}).json()["reply"]


def test_wisdom_endpoint(client: TestClient) -> None:
    for kind in ("quote", "fact", "any"):
        w = client.get("/api/wisdom", params={"kind": kind}).json()
        assert w["text"] and w["source"]


def test_buddy_page_is_served(client: TestClient) -> None:
    r = client.get("/buddy/")
    assert r.status_code == 200 and "Sheru" in r.text


def test_local_activity_feeds_dashboard_summary(client: TestClient) -> None:
    client.put("/api/profile", json=PROFILE)
    c = coach.get_coach()
    t0 = dt.datetime.now().replace(hour=10, minute=0, second=0, microsecond=0).timestamp()
    c.clock = lambda: t0
    c.ingest_desktop(coach.DesktopSample(app="Code", bundle_id="com.microsoft.VSCode", title="a.py", key_idle=1))
    c.tick()
    c.clock = lambda: t0 + 600
    c.ingest_desktop(coach.DesktopSample(app="Code", bundle_id="com.microsoft.VSCode", title="a.py", key_idle=1))
    c.tick()
    c._close_segment(t0 + 600)
    day = dt.date.today().isoformat()
    s = client.get("/api/summary", params={"date": day}).json()
    assert s["source"] == "local" and s["activeSeconds"] >= 590
    tl = client.get("/api/timeline", params={"date": day}).json()
    assert tl["events"][0]["hostname"] == "Code" and tl["events"][0]["category"] == "Coding"


def test_heuristic_dsa_youtube_counts_as_focus() -> None:
    act = Activity(domain="youtube.com", url="https://youtube.com/watch?v=x", title="Dynamic Programming in 1 shot")
    v = heuristic_verdict(act, ["Crack DSA for placements"], [], ["youtube"])
    assert v.kind == "focus" and v.ambiguous
    shorts = Activity(domain="youtube.com", url="https://youtube.com/shorts/x", title="graph meme #shorts")
    assert heuristic_verdict(shorts, ["Crack DSA for placements"], [], ["youtube"]).kind == "distraction"


def test_persona_guard_rejects_wrong_address_and_extra_emojis() -> None:
    from persona import acceptable_line, clean_line

    assert not acceptable_line("Hey Swami! Put down the reels, please!", "Arjun")
    assert not acceptable_line("Swamiji, stop scrolling and code.", "Arjun")
    assert not acceptable_line("Hi Rahul, time to get back to graphs!", "Arjun Mehta")
    assert acceptable_line("Hey Arjun, back to graphs! 🦁", "Arjun Mehta")
    assert acceptable_line("Psst, the reels can wait. Lions code first!", "Arjun")
    assert clean_line('Sheru: "Back to code, Arjun! 🦁 🐾 ✨"') == "Back to code, Arjun! 🦁"


@respx.mock
def test_llm_line_that_misnames_user_falls_back_to_template(client: TestClient) -> None:
    import asyncio

    client.put("/api/profile", json=PROFILE)
    respx.get(f"{OLLAMA}/api/tags").mock(return_value=httpx.Response(200, json={"models": []}))
    respx.post(f"{OLLAMA}/api/generate").mock(return_value=httpx.Response(200, json={"response": "Hey Swami! Drop the reels."}))
    brain = coach.get_coach().brain
    line = asyncio.run(brain.line("distraction1", name="Saksham", age=21, goal="Crack DSA", label="Instagram", minutes="1 minute"))
    assert line is None  # the coach then uses a template line


def test_long_model_lines_are_cut_to_whole_sentences() -> None:
    from persona import brief

    long = ("Saksham, that funny cat video won't help you crack DSA for placements! 🦁 Return to your code and "
            "I'll guide you like a lion cub raised among sheep with Swamiji's wisdom today.")
    assert brief(long) == "Saksham, that funny cat video won't help you crack DSA for placements! 🦁"
    assert brief("Back to code, Saksham! You've got this.") == "Back to code, Saksham! You've got this."
