"""ActivityWatch access (contract C2) and pure aggregation helpers (C3)."""
from __future__ import annotations

import datetime as dt
import logging
import re
from collections import defaultdict
from typing import Any, Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx

from config import Settings
from models import (
    AWUnreachable,
    DailySummaryResponse,
    Event,
    InvalidInput,
    Source,
    TimelineEvent,
    UpstreamError,
)
from activity_store import ActivityStore
from sample_data import sample_events

logger = logging.getLogger("pulse.aw")

DISTRACTION_THRESHOLD = 40
MAX_PROMPT_FIELD_CHARS = 80
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+")
AW_TIMEOUT_SECONDS = 10.0


# --------------------------------------------------------------------------- time
def resolve_tz(tz: Optional[str]) -> dt.tzinfo:
    """IANA name -> tzinfo; None -> server local zone. Bad names raise InvalidInput."""
    if not tz:
        local = dt.datetime.now().astimezone().tzinfo
        return local if local is not None else dt.timezone.utc
    try:
        return ZoneInfo(tz)
    except Exception as exc:  # ZoneInfoNotFoundError, ValueError, OSError
        raise InvalidInput(f"Unknown timezone '{tz}'") from exc


def day_window(date: dt.date, tz: Optional[str]) -> tuple[dt.datetime, dt.datetime]:
    """Local midnight -> next local midnight, as tz-aware datetimes."""
    zone = resolve_tz(tz)
    try:
        start = dt.datetime.combine(date, dt.time.min, tzinfo=zone)
        end = dt.datetime.combine(date + dt.timedelta(days=1), dt.time.min, tzinfo=zone)
        start.astimezone(dt.timezone.utc)
        end.astimezone(dt.timezone.utc)
    except (OverflowError, ValueError) as exc:
        raise InvalidInput(f"Date {date.isoformat()} is out of the supported range") from exc
    return start, end


def sanitize_prompt_field(value: Any, limit: int = MAX_PROMPT_FIELD_CHARS) -> str:
    """Strip newlines/control chars and cap length before a value enters an LLM prompt."""
    text = _CONTROL_CHARS.sub(" ", str(value)).strip()
    return text[:limit].rstrip()


# ------------------------------------------------------------------------ parsing
def _parse_timestamp(value: Any) -> Optional[dt.datetime]:
    if not isinstance(value, str) or not value:
        return None
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _hostname(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def _str(value: Any, default: str = "") -> str:
    return value.strip() if isinstance(value, str) and value.strip() else default


def parse_events(raw: Any) -> list[Event]:
    """Tolerantly convert AW events to Events: drop bad/zero-duration, default odd fields."""
    if not isinstance(raw, list):
        raise UpstreamError("ActivityWatch returned a malformed events payload")
    events: list[Event] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        ts = _parse_timestamp(item.get("timestamp"))
        duration = item.get("duration")
        if ts is None or isinstance(duration, bool) or not isinstance(duration, (int, float)):
            continue
        if not duration > 0:  # also drops NaN
            continue
        data = item.get("data")
        if not isinstance(data, dict):
            data = {}
        score_raw = data.get("ai_score")
        if isinstance(score_raw, bool) or not isinstance(score_raw, (int, float)) or score_raw != score_raw:
            score = 50
        else:
            score = int(round(max(0, min(100, score_raw))))
        url = _str(data.get("url"))
        events.append(
            Event(
                timestamp=ts,
                duration=float(duration),
                url=url,
                hostname=_hostname(url),
                title=_str(data.get("title")),
                score=score,
                category=_str(data.get("ai_category"), "Uncategorized"),
                reasoning=_str(data.get("ai_reasoning")),
                goal=_str(data.get("goal_active")) or None,
            )
        )
    events.sort(key=lambda e: e.timestamp)
    return events


# --------------------------------------------------------------------- AW fetching
async def _get_json(client: httpx.AsyncClient, url: str, params: Optional[dict[str, Any]] = None) -> Any:
    try:
        resp = await client.get(url, params=params)
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        raise AWUnreachable(f"ActivityWatch unreachable at {client.base_url}") from exc
    except httpx.HTTPError as exc:
        raise UpstreamError(f"ActivityWatch request failed: {exc.__class__.__name__}") from exc
    if resp.status_code >= 300:
        raise UpstreamError(f"ActivityWatch returned HTTP {resp.status_code} for {resp.request.url.path}")
    try:
        return resp.json()
    except ValueError as exc:
        raise UpstreamError("ActivityWatch returned invalid JSON") from exc


async def fetch_aw_events(settings: Settings, start: dt.datetime, end: dt.datetime) -> list[Event]:
    async with httpx.AsyncClient(base_url=settings.aw_server_url, timeout=AW_TIMEOUT_SECONDS) as client:
        buckets = await _get_json(client, "/api/0/buckets/")
        if not isinstance(buckets, dict):
            raise UpstreamError("ActivityWatch returned a malformed bucket list")
        ids = sorted(b for b in buckets if isinstance(b, str) and b.startswith(settings.aw_bucket_prefix))
        raw: list[Any] = []
        params = {
            "start": start.astimezone(dt.timezone.utc).isoformat(),
            "end": end.astimezone(dt.timezone.utc).isoformat(),
            "limit": -1,
        }
        for bucket_id in ids:
            payload = await _get_json(client, f"/api/0/buckets/{bucket_id}/events", params)
            if not isinstance(payload, list):
                raise UpstreamError("ActivityWatch returned a malformed events payload")
            raw.extend(payload)
    events = parse_events(raw)
    return [e for e in events if start <= e.timestamp < end]


def local_events(settings: Settings, start: dt.datetime, end: dt.datetime) -> list[Event]:
    """Whole-computer activity logged by Leo's coach (desktop app + extension)."""
    store = ActivityStore(settings.data_dir)
    if not store.path.exists():
        return []
    try:
        return store.events_between(start, end)
    except Exception as exc:  # a corrupt/locked db must not take the dashboard down
        logger.warning("could not read local activity: %s", exc)
        return []
    finally:
        store.close()


async def fetch_events(settings: Settings, date: dt.date, tz: Optional[str]) -> tuple[list[Event], Source]:
    """Resolve events for a day according to DATA_SOURCE (aw / sample / local / auto).

    auto: Leo's local log if it has anything for the day, else ActivityWatch, else sample data.
    """
    start, end = day_window(date, tz)
    if settings.data_source == "sample":
        return sample_events(date, tz), "sample"
    if settings.data_source in ("auto", "local"):
        events = local_events(settings, start, end)
        if events or settings.data_source == "local":
            return events, "local"
    try:
        return await fetch_aw_events(settings, start, end), "aw"
    except AWUnreachable:
        if settings.data_source == "auto":
            return sample_events(date, tz), "sample"
        raise
    except UpstreamError as exc:
        if settings.data_source == "auto":
            logger.warning("ActivityWatch error in auto mode, serving sample data: %s", exc.detail)
            return sample_events(date, tz), "sample"
        raise


# ------------------------------------------------------------------- aggregation
def _seconds(value: float) -> int:
    return int(round(value))


def compute_summary(events: list[Event], date: dt.date, source: Source) -> DailySummaryResponse:
    ordered = sorted(events, key=lambda e: e.timestamp)
    active = sum(e.duration for e in ordered if e.score >= DISTRACTION_THRESHOLD)
    distraction = sum(e.duration for e in ordered if e.score < DISTRACTION_THRESHOLD)
    total = active + distraction
    avg = round(sum(e.score * e.duration for e in ordered) / total, 1) if total > 0 else 0.0
    switches = sum(1 for a, b in zip(ordered, ordered[1:]) if a.hostname != b.hostname)
    cats: dict[str, float] = defaultdict(float)
    for e in ordered:
        cats[e.category.title()] += e.duration
    top = {k: _seconds(v) for k, v in sorted(cats.items(), key=lambda kv: (-kv[1], kv[0]))}
    active_s, distraction_s = _seconds(active), _seconds(distraction)
    return DailySummaryResponse(
        date=date.isoformat(),
        total_active_seconds=active_s + distraction_s,
        active_seconds=active_s,
        distraction_seconds=distraction_s,
        average_focus_score=avg,
        top_categories=top,
        context_switches=switches,
        source=source,
    )


def to_timeline(events: list[Event], tz: Optional[str] = None) -> list[TimelineEvent]:
    zone = resolve_tz(tz)
    return [
        TimelineEvent(
            timestamp=e.timestamp.astimezone(zone).isoformat(),
            duration_seconds=_seconds(e.duration),
            url=e.url,
            hostname=e.hostname,
            title=e.title,
            score=e.score,
            category=e.category.title(),
            reasoning=e.reasoning,
            goal=e.goal,
        )
        for e in sorted(events, key=lambda e: e.timestamp)
    ]


def compute_aggregates_for_prompt(events: list[Event], date: dt.date, source: Source = "aw") -> dict[str, Any]:
    """Compact stats for the standup prompt. No raw events/URLs beyond hostnames."""
    summary = compute_summary(events, date, source)
    sites: dict[str, float] = defaultdict(float)
    distract_sites: dict[str, float] = defaultdict(float)
    for e in events:
        host = sanitize_prompt_field(e.hostname) or "(unknown)"
        sites[host] += e.duration
        if e.score < DISTRACTION_THRESHOLD:
            distract_sites[host] += e.duration

    def top(d: dict[str, float], n: int) -> list[dict[str, Any]]:
        ranked = sorted(d.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
        return [{"site": k, "seconds": _seconds(v)} for k, v in ranked]

    goals = [g for g in (sanitize_prompt_field(e.goal) for e in events if e.goal) if g]
    goal = max(set(goals), key=goals.count) if goals else None
    categories: dict[str, int] = {}
    for name, secs in summary.top_categories.items():
        key = sanitize_prompt_field(name) or "Uncategorized"
        categories[key] = categories.get(key, 0) + secs
    return {
        "date": summary.date,
        "goal": goal,
        "totalActiveSeconds": summary.total_active_seconds,
        "activeSeconds": summary.active_seconds,
        "distractionSeconds": summary.distraction_seconds,
        "averageFocusScore": summary.average_focus_score,
        "contextSwitches": summary.context_switches,
        "topCategories": categories,
        "topSites": top(sites, 6),
        "topDistractionSites": top(distract_sites, 3),
    }
