from __future__ import annotations

import datetime as dt
from typing import Any, Callable, Iterator

import pytest
from fastapi.testclient import TestClient

import config
from models import Event

ENV_DEFAULTS = {
    "AW_SERVER_URL": "http://aw.test:5600",
    "OLLAMA_URL": "http://ollama.test:11434",
    "LLM_MODEL": "qwen3.5:4b",
    "DATA_SOURCE": "auto",
    "STANDUP_FALLBACK": "template",
    "AW_BUCKET_PREFIX": "aw-watcher-web-lighthouse",
    "LLM_TIMEOUT_SECONDS": "5",
}

AW = ENV_DEFAULTS["AW_SERVER_URL"]
OLLAMA = ENV_DEFAULTS["OLLAMA_URL"]
UTC = dt.timezone.utc


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> Iterator[Callable[..., None]]:
    import coach

    for k, v in ENV_DEFAULTS.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("SHERU_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("LLM_CLASSIFY", "off")
    config.get_settings.cache_clear()
    coach.reset_coach()

    def set_env(**kwargs: str) -> None:
        for k, v in kwargs.items():
            monkeypatch.setenv(k, v)
        config.get_settings.cache_clear()

    yield set_env
    config.get_settings.cache_clear()
    coach.reset_coach()


@pytest.fixture
def client() -> TestClient:
    from main import app

    return TestClient(app)


def aw_event(ts: str, duration: float, url: str = "https://github.com/x", score: Any = 90,
             category: str = "coding", title: str = "t", goal: Any = "ship it") -> dict[str, Any]:
    return {
        "timestamp": ts,
        "duration": duration,
        "data": {"url": url, "title": title, "ai_score": score, "ai_category": category,
                 "ai_reasoning": "because", "goal_active": goal, "audible": False,
                 "incognito": False, "tabCount": 3},
    }


def make_event(minute: int, duration: float, url: str, score: int, category: str = "Coding") -> Event:
    from urllib.parse import urlparse

    return Event(
        timestamp=dt.datetime(2026, 10, 6, 9, 0, tzinfo=UTC) + dt.timedelta(minutes=minute),
        duration=duration, url=url, hostname=urlparse(url).hostname or "", title="t",
        score=score, category=category, reasoning="r", goal="g",
    )
