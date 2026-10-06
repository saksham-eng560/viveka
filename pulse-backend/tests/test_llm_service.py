import datetime as dt
import json

import httpx
import pytest
import respx

from aw_queries import compute_aggregates_for_prompt
from config import get_settings
from llm_service import build_standup_prompt, fmt_duration, generate_standup, template_standup
from models import OllamaUnreachable, UpstreamError
from conftest import OLLAMA, make_event

D = dt.date(2026, 10, 6)
EVENTS = [make_event(0, 3600, "https://github.com/a", 95), make_event(60, 600, "https://www.reddit.com/r/x", 10, "Social Media")]


def test_fmt_duration() -> None:
    assert [fmt_duration(x) for x in (45, 300, 3600, 5400)] == ["45s", "5m", "1h", "1h 30m"]


def test_prompt_contains_only_aggregates() -> None:
    system, prompt = build_standup_prompt(compute_aggregates_for_prompt(EVENTS, D))
    for section in ("Done", "Highlights", "Distractions", "Tomorrow"):
        assert f"## {section}" in system
    assert "github.com (1h)" in prompt and "www.reddit.com (10m)" in prompt
    assert "https://" not in prompt and "Average focus score" in prompt


def test_template_reads_naturally() -> None:
    md = template_standup(compute_aggregates_for_prompt(EVENTS, D))
    for section in ("## Done", "## Highlights", "## Distractions", "## Tomorrow"):
        assert section in md
    assert "1h 10m" in md and "www.reddit.com" in md
    assert template_standup(compute_aggregates_for_prompt([], D)).count("No tracked activity") == 1


@respx.mock
async def test_llm_success_request_body() -> None:
    route = respx.post(f"{OLLAMA}/api/generate").respond(json={"response": "<think>x</think>## Done\n- stuff"})
    res = await generate_standup(get_settings(), EVENTS, D, "aw")
    assert (res.generated_by, res.model, res.source, res.markdown) == ("llm", "qwen3.5:4b", "aw", "## Done\n- stuff")
    body = json.loads(route.calls[0].request.content)
    assert body["stream"] is False and body["think"] is False and body["model"] == "qwen3.5:4b"
    assert body["options"] == {"temperature": 0.3, "num_predict": 700} and "format" not in body
    assert body["system"] and body["prompt"]


@pytest.mark.parametrize("exc", [httpx.ConnectError("x"), httpx.ReadTimeout("x"), httpx.ConnectTimeout("x")])
@respx.mock
async def test_unreachable_fallback_template(exc) -> None:
    respx.post(f"{OLLAMA}/api/generate").mock(side_effect=exc)
    res = await generate_standup(get_settings(), EVENTS, D, "sample")
    assert res.generated_by == "template" and res.model is None and res.source == "sample"


@respx.mock
async def test_unreachable_fallback_off(env) -> None:
    env(STANDUP_FALLBACK="off")
    respx.post(f"{OLLAMA}/api/generate").mock(side_effect=httpx.ConnectError("x"))
    with pytest.raises(OllamaUnreachable) as ei:
        await generate_standup(get_settings(), EVENTS, D, "aw")
    assert ei.value.detail == f"Ollama unreachable at {OLLAMA}"


@pytest.mark.parametrize("resp", [httpx.Response(500), httpx.Response(200, text="nope"), httpx.Response(200, json={"response": "  "}), httpx.Response(200, json=[1])])
@respx.mock
async def test_bad_upstream_is_502(resp) -> None:
    respx.post(f"{OLLAMA}/api/generate").mock(return_value=resp)
    with pytest.raises(UpstreamError):
        await generate_standup(get_settings(), EVENTS, D, "aw")


@respx.mock
async def test_empty_day_skips_llm() -> None:
    route = respx.post(f"{OLLAMA}/api/generate")
    res = await generate_standup(get_settings(), [], D, "aw")
    assert res.generated_by == "template" and "No tracked activity" in res.markdown
    assert not route.called
