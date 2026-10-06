"""Standup generation: prompt building, Ollama call (contract C4), template fallback."""
from __future__ import annotations

import datetime as dt
import json
import re
from typing import Any

import httpx

from aw_queries import compute_aggregates_for_prompt, sanitize_prompt_field
from config import Settings
from models import Event, OllamaUnreachable, Source, StandupNotesResponse, UpstreamError

STANDUP_SYSTEM_PROMPT = (
    "You are a concise assistant that writes a developer's daily standup notes from "
    "aggregated browsing-activity statistics. Output GitHub-flavoured markdown only, "
    "with exactly these four sections, each as a '## ' heading, in this order:\n"
    "## Done\n## Highlights\n## Distractions\n## Tomorrow\n"
    "Use short bullet points (max 4 per section). Be specific: mention the real sites, "
    "times and focus score from the stats. Be honest but kind about distractions. "
    "Never invent work that the stats do not support. Do not add any preamble or closing remarks."
)


def fmt_duration(seconds: float) -> str:
    total = int(round(seconds))
    hours, rem = divmod(total, 3600)
    minutes = rem // 60
    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    if minutes:
        return f"{minutes}m"
    return f"{total}s"


def build_standup_prompt(agg: dict[str, Any]) -> tuple[str, str]:
    """Return (system, prompt). Only aggregated stats are sent to the model."""
    clean = sanitize_prompt_field
    sites = ", ".join(f"{clean(s['site'])} ({fmt_duration(s['seconds'])})" for s in agg["topSites"]) or "none"
    distract = ", ".join(f"{clean(s['site'])} ({fmt_duration(s['seconds'])})" for s in agg["topDistractionSites"]) or "none"
    cats = ", ".join(f"{clean(k)} ({fmt_duration(v)})" for k, v in agg["topCategories"].items()) or "none"
    goal = clean(agg["goal"]) if agg["goal"] else ""
    prompt = (
        f"Date: {agg['date']}\n"
        f"Stated goal: {goal or 'not set'}\n"
        f"Total tracked time: {fmt_duration(agg['totalActiveSeconds'])}\n"
        f"Focused time (score >= 40): {fmt_duration(agg['activeSeconds'])}\n"
        f"Distraction time (score < 40): {fmt_duration(agg['distractionSeconds'])}\n"
        f"Average focus score: {agg['averageFocusScore']}/100\n"
        f"Context switches between sites: {agg['contextSwitches']}\n"
        f"Time by category: {cats}\n"
        f"Top sites by time: {sites}\n"
        f"Top distraction sites: {distract}\n\n"
        "Write today's standup notes now."
    )
    return STANDUP_SYSTEM_PROMPT, prompt


def template_standup(agg: dict[str, Any]) -> str:
    """Deterministic standup used when no LLM is available (or the day is empty)."""
    if agg["totalActiveSeconds"] <= 0:
        return f"## Standup for {agg['date']}\n\nNo tracked activity for this day."
    goal = agg["goal"]
    cats = list(agg["topCategories"].items())
    sites = agg["topSites"]
    distract = agg["topDistractionSites"]
    focus_pct = round(100 * agg["activeSeconds"] / agg["totalActiveSeconds"])
    lines = [f"## Standup for {agg['date']}", "", "## Done"]
    if goal:
        lines.append(f"- Worked toward: **{goal}**.")
    lines.append(
        f"- Tracked {fmt_duration(agg['totalActiveSeconds'])} in the browser, "
        f"{fmt_duration(agg['activeSeconds'])} of it focused ({focus_pct}%)."
    )
    if cats:
        lines.append("- Time by category: " + ", ".join(f"{k} {fmt_duration(v)}" for k, v in cats[:4]) + ".")
    lines += ["", "## Highlights"]
    lines.append(f"- Average focus score: **{agg['averageFocusScore']}/100**.")
    if sites:
        lines.append("- Most time on: " + ", ".join(f"{s['site']} ({fmt_duration(s['seconds'])})" for s in sites[:3]) + ".")
    lines += ["", "## Distractions"]
    if distract:
        lines.append(
            f"- {fmt_duration(agg['distractionSeconds'])} off-task, mostly "
            + ", ".join(f"{s['site']} ({fmt_duration(s['seconds'])})" for s in distract)
            + "."
        )
    else:
        lines.append("- No notable distractions. Nice work.")
    lines.append(f"- {agg['contextSwitches']} context switches between sites.")
    lines += ["", "## Tomorrow"]
    lines.append(f"- Continue with {goal}." if goal else "- Set a clear goal and pick up where today left off.")
    if distract:
        lines.append(f"- Keep {distract[0]['site']} for scheduled breaks to protect focus time.")
    return "\n".join(lines)


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


async def call_ollama(settings: Settings, system: str, prompt: str) -> str:
    body = {
        "model": settings.llm_model,
        "system": system,
        "prompt": prompt,
        "stream": False,
        "think": False,
        "options": {"temperature": 0.3, "num_predict": 700},
    }
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            resp = await client.post(f"{settings.ollama_url}/api/generate", json=body)
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        raise OllamaUnreachable(f"Ollama unreachable at {settings.ollama_url}") from exc
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Ollama request failed: {exc.__class__.__name__}") from exc
    if resp.status_code >= 300:
        raise UpstreamError(f"Ollama returned HTTP {resp.status_code}")
    try:
        text = resp.json().get("response")
    except (ValueError, AttributeError, json.JSONDecodeError) as exc:
        raise UpstreamError("Ollama returned a malformed response") from exc
    if not isinstance(text, str) or not _THINK_RE.sub("", text).strip():
        raise UpstreamError("Ollama returned an empty response")
    return _THINK_RE.sub("", text).strip()


async def generate_standup(
    settings: Settings, events: list[Event], date: dt.date, source: Source
) -> StandupNotesResponse:
    agg = compute_aggregates_for_prompt(events, date, source)
    if not events:  # nothing to summarise: skip the LLM entirely
        return StandupNotesResponse(markdown=template_standup(agg), generated_by="template", model=None, source=source)
    system, prompt = build_standup_prompt(agg)
    try:
        markdown = await call_ollama(settings, system, prompt)
    except OllamaUnreachable:
        if settings.standup_fallback == "template":
            return StandupNotesResponse(markdown=template_standup(agg), generated_by="template", model=None, source=source)
        raise
    return StandupNotesResponse(markdown=markdown, generated_by="llm", model=settings.llm_model, source=source)
