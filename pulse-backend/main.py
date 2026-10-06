"""Lighthouse Pulse backend. Run: uvicorn main:app --port 8000"""
from __future__ import annotations

import datetime as dt
from typing import Any, Literal, Optional, cast

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from aw_queries import compute_summary, fetch_events, to_timeline
from config import Settings, get_settings
from llm_service import generate_standup
from models import (
    AwHealth,
    DailySummaryResponse,
    HealthResponse,
    OllamaHealth,
    PulseError,
    StandupNotesResponse,
    StandupRequest,
    TimelineResponse,
)

app = FastAPI(title="Lighthouse Pulse", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


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
