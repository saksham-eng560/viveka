"""Environment-driven configuration (contract C1)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

_HERE = Path(__file__).resolve().parent
# Real environment variables always win (override=False); pulse-backend/.env
# is loaded first so it takes precedence over the repo-root .env.
load_dotenv(_HERE / ".env", override=False)
load_dotenv(_HERE.parent / ".env", override=False)

_DATA_SOURCES = ("aw", "sample", "auto", "local")
_FALLBACKS = ("template", "off")


@dataclass(frozen=True)
class Settings:
    aw_server_url: str = "http://localhost:5600"
    ollama_url: str = "http://localhost:11434"
    llm_model: str = "qwen3.5:4b"
    data_source: str = "auto"
    standup_fallback: str = "template"
    aw_bucket_prefix: str = "aw-watcher-web-lighthouse"
    llm_timeout_seconds: float = 120.0
    # Sheru, the desktop buddy (coach engine)
    data_dir: str = str(_HERE.parent / ".data")
    buddy_model: str = "sheru"
    llm_classify: bool = True
    coach_tick_seconds: float = 1.0


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def _choice(name: str, default: str, allowed: tuple[str, ...]) -> str:
    value = _env(name, default).lower()
    return value if value in allowed else default


def _float(name: str, default: float) -> float:
    try:
        value = float(_env(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        aw_server_url=_env("AW_SERVER_URL", "http://localhost:5600").rstrip("/"),
        ollama_url=_env("OLLAMA_URL", "http://localhost:11434").rstrip("/"),
        llm_model=_env("LLM_MODEL", "qwen3.5:4b"),
        data_source=_choice("DATA_SOURCE", "auto", _DATA_SOURCES),
        standup_fallback=_choice("STANDUP_FALLBACK", "template", _FALLBACKS),
        aw_bucket_prefix=_env("AW_BUCKET_PREFIX", "aw-watcher-web-lighthouse"),
        llm_timeout_seconds=_float("LLM_TIMEOUT_SECONDS", 120.0),
        data_dir=_env("LIGHTHOUSE_DATA_DIR", str(_HERE.parent / ".data")),
        buddy_model=_env("BUDDY_MODEL", "sheru"),
        llm_classify=_env("LLM_CLASSIFY", "on").lower() not in ("0", "off", "false", "no"),
        coach_tick_seconds=_float("COACH_TICK_SECONDS", 1.0),
    )
