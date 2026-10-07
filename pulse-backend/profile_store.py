"""The user's onboarding profile, stored as one JSON file in the local data dir."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Literal, Optional

from pydantic import Field, field_validator

from catalog import VerdictKind
from models import CamelModel

Pace = Literal["gentle", "balanced", "demo"]
QuoteFrequency = Literal["often", "sometimes", "rarely", "off"]
Personality = Literal["gentle", "playful", "coach"]
SpeakScope = Literal["important", "everything"]

_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def _clean(text: str, limit: int) -> str:
    return _CONTROL.sub(" ", text).strip()[:limit].strip()


def _clean_list(items: list[str], limit: int, each: int) -> list[str]:
    out: list[str] = []
    for item in items:
        c = _clean(str(item), each)
        if c and c.lower() not in (o.lower() for o in out):
            out.append(c)
    return out[:limit]


class Timings(CamelModel):
    """Optional per-user overrides (seconds) on top of the chosen pace preset."""

    headsup: Optional[float] = Field(default=None, ge=1, le=600)
    distraction: Optional[float] = Field(default=None, ge=3, le=3600)
    repeat: Optional[float] = Field(default=None, ge=10, le=7200)
    stall: Optional[float] = Field(default=None, ge=5, le=3600)
    afk: Optional[float] = Field(default=None, ge=30, le=7200)
    snooze: Optional[float] = Field(default=None, ge=5, le=3600)
    break_len: Optional[float] = Field(default=None, ge=30, le=3600)


class Detectors(CamelModel):
    headsup: bool = True  # gentle "wrong tab?" note
    detour: bool = True  # stronger alerts when staying off-goal
    stall: bool = True  # writing-stall nudges
    hopping: bool = True  # many app/tab switches
    streak: bool = True  # focus-streak celebrations
    welcome_back: bool = True  # greeting after being away


class VoiceSettings(CamelModel):
    voice: str = Field(default="af_heart", max_length=40)  # Kokoro voice id, or "system"
    speed: float = Field(default=1.0, ge=0.7, le=1.4)
    pitch: float = Field(default=6.0, ge=-10, le=25)  # percent; a little higher sounds like a cub
    volume: float = Field(default=0.9, ge=0.0, le=1.0)
    speak: SpeakScope = "important"


class LeoSettings(CamelModel):
    timings: Timings = Field(default_factory=Timings)
    detectors: Detectors = Field(default_factory=Detectors)
    voice: VoiceSettings = Field(default_factory=VoiceSettings)
    personality: Personality = "playful"
    use_ai: bool = True
    show_status_chip: bool = True


class ProfileIn(CamelModel):
    name: str = Field(min_length=1, max_length=40)
    age: Optional[int] = Field(default=None, ge=5, le=120)
    goals: list[str] = Field(min_length=1, max_length=8)
    work_tools: list[str] = Field(default_factory=list, max_length=30)
    distractions: list[str] = Field(default_factory=list, max_length=30)
    pace: Pace = "balanced"
    quotes: QuoteFrequency = "sometimes"
    voice: bool = False
    sounds: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = _clean(v, 40)
        if not v:
            raise ValueError("Please tell me your name")
        return v

    @field_validator("goals")
    @classmethod
    def _goals(cls, v: list[str]) -> list[str]:
        v = _clean_list(v, 8, 120)
        if not v:
            raise ValueError("Add at least one goal")
        return v

    @field_validator("work_tools", "distractions")
    @classmethod
    def _chips(cls, v: list[str]) -> list[str]:
        return _clean_list(v, 30, 60)


class Profile(ProfileIn):
    overrides: dict[str, VerdictKind] = Field(default_factory=dict)
    settings: LeoSettings = Field(default_factory=LeoSettings)
    created_at: str = ""
    updated_at: str = ""

    @property
    def first_name(self) -> str:
        return self.name.split()[0] if self.name.split() else self.name

    @property
    def main_goal(self) -> str:
        return self.goals[0] if self.goals else "your goal"


class ProfileStore:
    def __init__(self, data_dir: str | Path) -> None:
        self.path = Path(data_dir) / "profile.json"
        self._cache: Optional[Profile] = None
        self._loaded = False

    def load(self) -> Optional[Profile]:
        if self._loaded:
            return self._cache
        self._loaded = True
        try:
            self._cache = Profile.model_validate(json.loads(self.path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            self._cache = None
        return self._cache

    def _write(self, profile: Profile) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(profile.model_dump(by_alias=True), indent=2, ensure_ascii=False)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".profile-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        self._cache, self._loaded = profile, True

    def save(self, incoming: ProfileIn) -> Profile:
        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        prev = self.load()
        profile = Profile(
            **incoming.model_dump(),
            overrides=prev.overrides if prev else {},
            settings=prev.settings if prev else LeoSettings(),
            created_at=prev.created_at if prev and prev.created_at else now,
            updated_at=now,
        )
        self._write(profile)
        return profile

    def set_override(self, key: str, kind: VerdictKind) -> Optional[Profile]:
        prev = self.load()
        if prev is None:
            return None
        updated = prev.model_copy(update={"overrides": {**prev.overrides, key: kind}})
        self._write(updated)
        return updated

    def update(self, **fields: object) -> Optional[Profile]:
        prev = self.load()
        if prev is None:
            return None
        updated = Profile.model_validate({**prev.model_dump(), **fields})
        self._write(updated)
        return updated

    def reset(self) -> None:
        self.path.unlink(missing_ok=True)
        self._cache, self._loaded = None, True
