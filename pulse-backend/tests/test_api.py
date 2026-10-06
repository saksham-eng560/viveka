import httpx
import respx
from fastapi.testclient import TestClient

from conftest import AW, OLLAMA, aw_event

DATE = "2026-10-06"
GEN = f"{OLLAMA}/api/generate"


def aw_up(events: list, buckets=("aw-watcher-web-lighthouse",)) -> None:
    respx.get(f"{AW}/api/0/buckets/").respond(json={b: {} for b in buckets})
    for b in buckets:
        respx.get(f"{AW}/api/0/buckets/{b}/events").respond(json=events)


@respx.mock
def test_summary_sample_when_aw_down(client: TestClient) -> None:
    respx.get(f"{AW}/api/0/buckets/").mock(side_effect=httpx.ConnectError("x"))
    r = client.get("/api/summary", params={"date": DATE, "tz": "UTC"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"date", "totalActiveSeconds", "activeSeconds", "distractionSeconds",
                         "averageFocusScore", "topCategories", "contextSwitches", "source"}
    assert body["source"] == "sample" and body["date"] == DATE and body["contextSwitches"] >= 15
    assert body["totalActiveSeconds"] == body["activeSeconds"] + body["distractionSeconds"]


@respx.mock
def test_summary_from_aw(client: TestClient) -> None:
    aw_up([aw_event("2026-10-06T09:00:00Z", 120, score=30), aw_event("2026-10-06T09:02:00Z", 60, "https://x.com", 80)])
    body = client.get("/api/summary", params={"date": DATE, "tz": "UTC"}).json()
    assert body["source"] == "aw" and body["distractionSeconds"] == 120 and body["activeSeconds"] == 60
    assert body["contextSwitches"] == 1 and body["averageFocusScore"] == 46.7


@respx.mock
def test_aw_empty_day_zeros(client: TestClient) -> None:
    aw_up([])
    body = client.get("/api/summary", params={"date": DATE}).json()
    assert body["source"] == "aw" and body["totalActiveSeconds"] == 0
    tl = client.get("/api/timeline", params={"date": DATE}).json()
    assert tl == {"date": DATE, "source": "aw", "events": []}


@respx.mock
def test_strict_aw_down_503(client: TestClient, env) -> None:
    env(DATA_SOURCE="aw")
    respx.get(f"{AW}/api/0/buckets/").mock(side_effect=httpx.ConnectTimeout("x"))
    for r in (client.get("/api/summary", params={"date": DATE}), client.get("/api/timeline", params={"date": DATE}),
              client.post("/api/generate-standup", json={"date": DATE})):
        assert r.status_code == 503 and r.json() == {"detail": f"ActivityWatch unreachable at {AW}"}


@respx.mock
def test_aw_500_is_502(client: TestClient, env) -> None:
    env(DATA_SOURCE="aw")
    respx.get(f"{AW}/api/0/buckets/").respond(500)
    assert client.get("/api/summary", params={"date": DATE}).status_code == 502


@respx.mock
def test_auto_aw_403_falls_back_to_sample(client: TestClient) -> None:
    respx.get(f"{AW}/api/0/buckets/").respond(403)
    r = client.get("/api/summary", params={"date": DATE})
    assert r.status_code == 200 and r.json()["source"] == "sample"


@respx.mock
def test_aw_mode_403_is_502(client: TestClient, env) -> None:
    env(DATA_SOURCE="aw")
    respx.get(f"{AW}/api/0/buckets/").respond(403)
    assert client.get("/api/summary", params={"date": DATE}).status_code == 502


def test_out_of_range_date_is_422(client: TestClient) -> None:
    assert client.get("/api/summary", params={"date": "9999-12-31"}).status_code == 422


def test_timeline_sample_camel_keys_sorted(client: TestClient) -> None:
    with respx.mock:
        respx.get(f"{AW}/api/0/buckets/").mock(side_effect=httpx.ConnectError("x"))
        body = client.get("/api/timeline", params={"date": DATE, "tz": "UTC"}).json()
    assert body["source"] == "sample"
    ev = body["events"]
    assert set(ev[0]) == {"timestamp", "durationSeconds", "url", "hostname", "title", "score", "category", "reasoning", "goal"}
    assert [e["timestamp"] for e in ev] == sorted(e["timestamp"] for e in ev)


def test_validation_422(client: TestClient) -> None:
    assert client.get("/api/summary", params={"date": "nope"}).status_code == 422
    assert client.get("/api/summary").status_code == 422
    assert client.get("/api/timeline", params={"date": "2026-13-45"}).status_code == 422
    assert client.post("/api/generate-standup", json={"date": "x"}).status_code == 422
    with respx.mock:
        r = client.get("/api/summary", params={"date": DATE, "tz": "Not/AZone"})
    assert r.status_code == 422 and "timezone" in r.json()["detail"]


@respx.mock
def test_standup_llm(client: TestClient) -> None:
    respx.get(f"{AW}/api/0/buckets/").mock(side_effect=httpx.ConnectError("x"))
    respx.post(GEN).respond(json={"response": "## Done\n- built charts"})
    r = client.post("/api/generate-standup", json={"date": DATE, "tz": "UTC"})
    assert r.status_code == 200
    assert r.json() == {"markdown": "## Done\n- built charts", "generatedBy": "llm", "model": "qwen3.5:4b", "source": "sample"}


@respx.mock
def test_standup_ollama_down_template_then_503(client: TestClient, env) -> None:
    respx.get(f"{AW}/api/0/buckets/").mock(side_effect=httpx.ConnectError("x"))
    respx.post(GEN).mock(side_effect=httpx.ConnectError("x"))
    r = client.post("/api/generate-standup", json={"date": DATE})
    assert r.status_code == 200 and r.json()["generatedBy"] == "template" and "## Done" in r.json()["markdown"]
    env(STANDUP_FALLBACK="off")
    r = client.post("/api/generate-standup", json={"date": DATE})
    assert r.status_code == 503 and r.json() == {"detail": f"Ollama unreachable at {OLLAMA}"}


@respx.mock
def test_standup_ollama_500_is_502(client: TestClient) -> None:
    respx.get(f"{AW}/api/0/buckets/").mock(side_effect=httpx.ConnectError("x"))
    respx.post(GEN).respond(500)
    assert client.post("/api/generate-standup", json={"date": DATE}).status_code == 502


@respx.mock
def test_standup_empty_day_no_llm(client: TestClient) -> None:
    aw_up([])
    route = respx.post(GEN)
    r = client.post("/api/generate-standup", json={"date": DATE})
    assert r.status_code == 200 and r.json()["generatedBy"] == "template" and r.json()["source"] == "aw"
    assert "No tracked activity" in r.json()["markdown"] and not route.called


@respx.mock
def test_health_combinations(client: TestClient) -> None:
    respx.get(f"{AW}/api/0/info").mock(side_effect=httpx.ConnectError("x"))
    respx.get(f"{OLLAMA}/api/tags").mock(side_effect=httpx.ConnectError("x"))
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {
        "status": "ok", "dataSource": "auto", "aw": {"reachable": False, "url": AW},
        "ollama": {"reachable": False, "url": OLLAMA, "model": "qwen3.5:4b", "modelAvailable": False}}

    respx.get(f"{AW}/api/0/info").respond(json={"version": "v0.13"})
    respx.get(f"{OLLAMA}/api/tags").respond(json={"models": [{"name": "llama3:latest"}]})
    b = client.get("/api/health").json()
    assert b["aw"]["reachable"] and b["ollama"]["reachable"] and not b["ollama"]["modelAvailable"]

    respx.get(f"{OLLAMA}/api/tags").respond(json={"models": [{"name": "qwen3.5:4b"}]})
    assert client.get("/api/health").json()["ollama"]["modelAvailable"] is True

    respx.get(f"{AW}/api/0/info").respond(500)
    respx.get(f"{OLLAMA}/api/tags").respond(text="not json")
    r = client.get("/api/health")
    assert r.status_code == 200 and not r.json()["aw"]["reachable"] and r.json()["ollama"]["reachable"]


def test_cors_open(client: TestClient) -> None:
    with respx.mock:
        respx.get(f"{AW}/api/0/info").mock(side_effect=httpx.ConnectError("x"))
        respx.get(f"{OLLAMA}/api/tags").mock(side_effect=httpx.ConnectError("x"))
        r = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert r.headers["access-control-allow-origin"] == "*"
