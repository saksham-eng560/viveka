"""Viveka backend (Leo's brain + day analytics). Run: uvicorn main:app --port 8000"""
from __future__ import annotations

import asyncio
import datetime as dt
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any, AsyncIterator, Literal, Optional, cast

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import Field

from aw_queries import compute_summary, fetch_events, to_timeline
from catalog import VerdictKind, catalog_payload
from coach import PACES, BrowserSample, DesktopSample, get_coach
from config import Settings, get_settings
from llm_service import generate_standup
from models import (
    AwHealth,
    CamelModel,
    DailySummaryResponse,
    HealthResponse,
    OllamaHealth,
    PulseError,
    StandupNotesResponse,
    StandupRequest,
    TimelineResponse,
)
from profile_store import Pace, ProfileIn, QuoteFrequency, LeoSettings
from vivekananda import WisdomPicker
from voice import SYSTEM_VOICE, VoiceUnavailable, effective_speed, get_voice

BUDDY_WEB = Path(__file__).resolve().parent.parent / "buddy" / "web"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    coach = get_coach()
    coach.voice = get_voice()
    coach.warm_voice()
    task = asyncio.create_task(coach.run())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        get_voice().shutdown()


app = FastAPI(title="Viveka", version="3.1.0", lifespan=lifespan,
              description="Leo's brain: the focus coach, onboarding profile, settings, voice and day analytics.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
if BUDDY_WEB.is_dir():
    app.mount("/buddy", StaticFiles(directory=BUDDY_WEB, html=True), name="buddy")


@app.exception_handler(PulseError)
async def pulse_error_handler(_: Request, exc: PulseError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/api/summary", response_model=DailySummaryResponse, response_model_by_alias=True)
async def summary(date: dt.date = Query(...), tz: Optional[str] = Query(None)) -> DailySummaryResponse:
    events, source = await fetch_events(get_settings(), date, tz)
    return compute_summary(events, date, source)


@app.get("/api/timeline", response_model=TimelineResponse, response_model_by_alias=True)
async def timeline(date: dt.date = Query(...), tz: Optional[str] = Query(None)) -> TimelineResponse:
    events, source = await fetch_events(get_settings(), date, tz)
    return TimelineResponse(date=date.isoformat(), source=source, events=to_timeline(events, tz))


@app.post("/api/generate-standup", response_model=StandupNotesResponse, response_model_by_alias=True)
async def standup(body: StandupRequest) -> StandupNotesResponse:
    settings = get_settings()
    events, source = await fetch_events(settings, body.date, body.tz)
    return await generate_standup(settings, events, body.date, source)


async def _probe(url: str) -> Optional[Any]:
    """GET url; return parsed JSON (or True for non-JSON 2xx) if reachable and 2xx, else None."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(url)
    except httpx.HTTPError:
        return None
    if resp.status_code >= 300:
        return None
    try:
        return resp.json()
    except ValueError:
        return True


def _model_available(tags: Any, model: str) -> bool:
    if not isinstance(tags, dict) or not isinstance(tags.get("models"), list):
        return False
    wanted = {model, model if ":" in model else f"{model}:latest"}
    for m in tags["models"]:
        if isinstance(m, dict) and (m.get("name") in wanted or m.get("model") in wanted):
            return True
    return False


@app.get("/api/health", response_model=HealthResponse, response_model_by_alias=True)
async def health() -> HealthResponse:
    s: Settings = get_settings()
    aw = await _probe(f"{s.aw_server_url}/api/0/info")
    tags = await _probe(f"{s.ollama_url}/api/tags")
    return HealthResponse(
        status="ok",
        data_source=cast(Literal["aw", "sample", "auto"], s.data_source),
        aw=AwHealth(reachable=aw is not None, url=s.aw_server_url),
        ollama=OllamaHealth(
            reachable=tags is not None,
            url=s.ollama_url,
            model=s.llm_model,
            model_available=_model_available(tags, s.llm_model),
        ),
    )


# ------------------------------------------------------------------- Leo / coach
class DesktopSampleIn(CamelModel):
    app: str = Field(default="", max_length=200)
    bundle_id: str = Field(default="", max_length=200)
    title: str = Field(default="", max_length=500)
    key_idle: float = Field(default=0.0, ge=0)
    input_idle: float = Field(default=0.0, ge=0)
    locked: bool = False
    ax_trusted: bool = False


class BrowserSampleIn(CamelModel):
    url: str = Field(default="", max_length=2000)
    title: str = Field(default="", max_length=500)
    audible: bool = False
    focused: bool = True
    incognito: bool = False
    tab_id: int = -1
    browser: str = Field(default="Chrome", max_length=40)


class ActionIn(CamelModel):
    action: str = Field(max_length=40)
    message_id: Optional[int] = None
    minutes: Optional[float] = Field(default=None, gt=0, le=240)


class ChatIn(CamelModel):
    text: str = Field(min_length=1, max_length=400)


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse("/docs")


@app.get("/api/catalog")
async def catalog() -> dict[str, Any]:
    return catalog_payload()


@app.get("/api/profile")
async def get_profile() -> dict[str, Any]:
    p = get_coach().profile
    return {"exists": p is not None, "profile": p.model_dump(by_alias=True) if p else None}


@app.put("/api/profile")
async def put_profile(body: ProfileIn) -> dict[str, Any]:
    coach = get_coach()
    saved = coach.profiles.save(body)
    coach.on_profile_saved()
    return {"exists": True, "profile": saved.model_dump(by_alias=True)}


@app.delete("/api/profile")
async def delete_profile() -> dict[str, Any]:
    coach = get_coach()
    coach.profiles.reset()
    coach.reset_session()
    coach.greet()
    return {"exists": False, "profile": None}


@app.post("/api/desktop/sample")
async def desktop_sample(body: DesktopSampleIn) -> dict[str, Any]:
    coach = get_coach()
    coach.ingest_desktop(DesktopSample(**body.model_dump()))
    return {"ok": True}


@app.post("/api/browser/sample")
async def browser_sample(body: BrowserSampleIn) -> dict[str, Any]:
    return get_coach().ingest_browser(BrowserSample(**body.model_dump()))


@app.get("/api/buddy/state")
async def buddy_state(since: int = Query(0, ge=0)) -> dict[str, Any]:
    return get_coach().state(since)


@app.post("/api/buddy/action")
async def buddy_action(body: ActionIn) -> dict[str, Any]:
    return get_coach().action(body.action, body.message_id, body.minutes)


@app.post("/api/buddy/chat")
async def buddy_chat(body: ChatIn) -> dict[str, Any]:
    return await get_coach().chat(body.text)


_picker = WisdomPicker()


@app.get("/api/wisdom")
async def wisdom(kind: Literal["quote", "fact", "any"] = "any") -> dict[str, Any]:
    w = _picker.quote() if kind == "quote" else _picker.fact() if kind == "fact" else _picker.any()
    return {"id": w.id, "kind": w.kind, "text": w.text, "source": w.source}


@app.get("/api/today")
async def today() -> dict[str, Any]:
    coach = get_coach()
    return {**coach.today(), "state": coach.state(since=10**9)}


# ------------------------------------------------------------------------- settings
class NeedsProfile(PulseError):
    status_code = 409


_TIMING_KEYS = ("headsup", "distraction", "repeat", "stall", "afk", "snooze", "break_len")


def _timings(pace: object) -> dict[str, float]:
    return {to_camel_key(k): float(getattr(pace, k)) for k in _TIMING_KEYS}


def to_camel_key(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(part.title() for part in rest)


class SettingsIn(CamelModel):
    settings: Optional[LeoSettings] = None
    pace: Optional[Pace] = None
    quotes: Optional[QuoteFrequency] = None
    voice: Optional[bool] = None  # speak out loud
    sounds: Optional[bool] = None
    overrides: Optional[dict[str, VerdictKind]] = Field(default=None, max_length=500)


def _settings_payload() -> dict[str, Any]:
    coach = get_coach()
    p = coach.profile
    if p is None:
        raise NeedsProfile("Set up Leo first (onboarding)")
    return {
        "settings": p.settings.model_dump(by_alias=True),
        "pace": p.pace,
        "quotes": p.quotes,
        "voice": p.voice,
        "sounds": p.sounds,
        "overrides": p.overrides,
        "effective": _timings(coach.pace),
        "presets": {name: _timings(preset) for name, preset in PACES.items()},
        "voiceEngine": get_voice().status(),
    }


@app.get("/api/settings")
async def get_settings_view() -> dict[str, Any]:
    return _settings_payload()


@app.put("/api/settings")
async def put_settings(body: SettingsIn) -> dict[str, Any]:
    coach = get_coach()
    if coach.profile is None:
        raise NeedsProfile("Set up Leo first (onboarding)")
    fields: dict[str, Any] = {}
    if body.settings is not None:
        fields["settings"] = body.settings.model_dump()
    for name in ("pace", "quotes", "voice", "sounds"):
        value = getattr(body, name)
        if value is not None:
            fields[name] = value
    if body.overrides is not None:
        fields["overrides"] = {k: v for k, v in body.overrides.items() if k.startswith(("web:", "app:"))}
    if fields:
        coach.profiles.update(**fields)
        coach.settings_changed()
    return _settings_payload()


@app.delete("/api/history")
async def delete_history() -> dict[str, Any]:
    coach = get_coach()
    coach.store.clear()
    coach.messages.clear()
    coach.settings_changed()
    return {"ok": True}


# ---------------------------------------------------------------------------- voice
class SayIn(CamelModel):
    text: str = Field(min_length=1, max_length=400)
    voice: Optional[str] = Field(default=None, max_length=40)
    speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    pitch: Optional[float] = Field(default=None, ge=-20, le=40)


@app.get("/api/voice")
async def voice_status() -> dict[str, Any]:
    return get_voice().status()


@app.post("/api/voice/say")
async def voice_say(body: SayIn) -> Response:
    """WAV for one chunk of speech; uses the saved voice settings unless the request overrides them (preview)."""
    coach = get_coach()
    saved = coach.prefs.voice
    voice = body.voice or saved.voice
    if voice != SYSTEM_VOICE and not voice.replace("_", "").isalnum():
        voice = saved.voice
    speed = effective_speed(body.speed if body.speed is not None else saved.speed,
                            body.pitch if body.pitch is not None else saved.pitch)
    try:
        audio = await get_voice().speak(body.text.strip(), voice, speed)
    except VoiceUnavailable as exc:
        return JSONResponse(status_code=503, content={"detail": str(exc)})
    except Exception:  # never 500 the buddy over audio
        return JSONResponse(status_code=503, content={"detail": "speech failed"})
    return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600"})
