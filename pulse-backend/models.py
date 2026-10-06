"""Pydantic models (contract C3) and internal error types. JSON is camelCase."""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Source = Literal["aw", "sample", "local"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class DailySummaryResponse(CamelModel):
    date: str
    total_active_seconds: int
    active_seconds: int
    distraction_seconds: int
    average_focus_score: float
    top_categories: dict[str, int]
    context_switches: int
    source: Source


class TimelineEvent(CamelModel):
    timestamp: str
    duration_seconds: int
    url: str
    hostname: str
    title: str
    score: int
    category: str
    reasoning: str
    goal: Optional[str] = None


class TimelineResponse(CamelModel):
    date: str
    source: Source
    events: list[TimelineEvent]


class StandupRequest(CamelModel):
    date: dt.date
    tz: Optional[str] = None


class StandupNotesResponse(CamelModel):
    markdown: str
    generated_by: Literal["llm", "template"]
    model: Optional[str] = None
    source: Source


class AwHealth(CamelModel):
    reachable: bool
    url: str


class OllamaHealth(CamelModel):
    reachable: bool
    url: str
    model: str
    model_available: bool


class HealthResponse(CamelModel):
    status: Literal["ok"] = "ok"
    data_source: Literal["aw", "sample", "auto", "local"]
    aw: AwHealth
    ollama: OllamaHealth


class ErrorBody(CamelModel):
    detail: str


@dataclass(frozen=True)
class Event:
    """Normalised internal activity event (one tracked span of tab focus)."""

    timestamp: dt.datetime  # timezone-aware
    duration: float  # seconds, > 0
    url: str
    hostname: str
    title: str
    score: int
    category: str
    reasoning: str
    goal: Optional[str]


class PulseError(Exception):
    """Base for errors mapped to HTTP responses."""

    status_code = 500

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class AWUnreachable(PulseError):
    status_code = 503


class OllamaUnreachable(PulseError):
    status_code = 503


class UpstreamError(PulseError):
    status_code = 502


class InvalidInput(PulseError):
    status_code = 422
