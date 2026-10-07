"""Leo's voice: playful template lines plus local-LLM personalisation (Ollama).

Templates make every message instant and offline-safe. When Ollama is up, the coach
asks the `viveka-leo` model (a Modelfile layered on the base model, see ollama/Modelfile.leo)
for a fresher, personalised line and falls back to the template on any problem.
"""
from __future__ import annotations

import json
import logging
import random
import re
import time
from typing import Any, Optional

import httpx

from catalog import Activity, Verdict
from config import Settings

logger = logging.getLogger("pulse.persona")

PERSONA = (
    "You are Leo, a tiny lion cub who lives on the user's desktop. You wear a little saffron turban and fold your "
    "paws like Swami Vivekananda in Chicago, because you grew up on his story of the lion cub raised among sheep. "
    "You are warm, playful and encouraging, never preachy, never shaming. You speak in short, simple sentences "
    "with gentle humour and at most one emoji. You care about the user's goals."
)

# How Leo speaks, chosen in Settings (added to the persona for model-written lines and chat).
PERSONALITIES = {
    "gentle": " Right now be extra gentle and calm: soft words, no teasing, few exclamation marks.",
    "playful": "",
    "coach": " Right now be an upbeat coach: direct, energetic and short, still kind and never harsh.",
}


def persona(personality: str = "playful") -> str:
    return PERSONA + PERSONALITIES.get(personality, "")


TEMPLATES: dict[str, list[str]] = {
    "greeting": [
        "Namaste, {name}! 🙏 I'm Leo. Today we chase: {goal}. I'll sit right here.",
        "Hi {name}! Paws folded, turban on. Today's mission: {goal}.",
        "Namaste {name}! A lion cub reporting for duty. First up: {goal}.",
    ],
    "headsup": [
        "Psst, {name}... {label} looks like the wrong {place} for your goal. No rush, just a gentle heads-up. 🌿",
        "Hmm, {label}? I don't think that's the right {place} for '{goal}', {name}. Shall we switch back?",
        "Little lion check: you're on {label}. That's not on today's plan. Wrong {place}, maybe? 🙂",
        "{name}, a gentle reminder: {label} isn't part of '{goal}'. I'll give you a moment.",
    ],
    "distraction1": [
        "Psst, {name}! {label} is cute, but your goals are cuter. Shall we hop back?",
        "Tiny paw tap 🐾 {label} isn't on today's plan. Your goal is waiting: {goal}.",
        "Hey {name}, I spotted {label}. Lions chase goals, not feeds!",
        "Rawr-ning! {label} has been nibbling your focus for {minutes}. Back to it?",
        "Ooh, {label}. I peeked too! Now let's both get back to work.",
    ],
    "distraction2": [
        "Okay {name}, {minutes} on {label}. Swamiji said 'Arise, awake!' That includes the scroll thumb.",
        "I'm not mad, just a little lion-sad 🥺 {minutes} on {label}. One small step back to work?",
        "{name}, we've wandered into {label} for {minutes}. You're a lion, not a sheep! Back we go?",
        "Still on {label}? Let's make a deal: close it now, and I'll cheer the loudest when you're back.",
    ],
    "stall1": [
        "Thinking pause? Take a slow breath. Then just one more sentence. ✍️",
        "Quiet keyboard... pondering something big? Here's a little fuel for your thoughts.",
        "Stuck for a moment? That's normal. Write the next tiny bit, even if it's messy.",
    ],
    "stall2": [
        "Still quiet, {name}. Try the messiest first line ever. We'll fix it later!",
        "Let's do a 2-minute sprint: type anything at all. Messy is fine. Go!",
        "Psst. The blank part won't fill itself. One line, then we celebrate.",
    ],
    "stall3": [
        "{name}, I think we've drifted. {label} has been quiet for {minutes}. Reset, or a real 5-minute break?",
        "Looks like focus slipped away, {name}. {minutes} without a word in {label}. Want a fresh start?",
        "Hmm, we're distracted, aren't we? {minutes} of quiet in {label}. Let's pick ONE small next step.",
    ],
    "back": [
        "Yay, back on track! 🦁",
        "That's my lion! Welcome back.",
        "Focus mode: ON. Proud of you, {name}.",
        "And we're back! The sheep could never.",
    ],
    "typing_again": [
        "There it is! Keep those paws typing. 🐾",
        "Words are flowing again. Love to see it!",
        "Yes! Momentum is back.",
    ],
    "away_back": [
        "Welcome back, {name}! Ready to pick up where we left off?",
        "Oh hi! I kept your seat warm. Shall we continue?",
    ],
    "break_start": [
        "Enjoy your {minutes} break! Stretch, sip water, look far away. I'll call you back.",
        "Break time! {minutes} of rest. Lions nap too, you know.",
    ],
    "break_end": [
        "Break's over, {name}! Let's ease back in.",
        "Ding! Break done. One gentle step back in?",
    ],
    "snooze": [
        "Okay, {minutes} more. I'm counting on my paws!",
        "Deal! {minutes}, then we're back to work.",
    ],
    "storm": [
        "Whoa, lots of hopping around! 🐇 Pick just one thing for the next 10 minutes?",
        "So many windows! Let's choose one and give it our whole heart.",
    ],
    "streak": [
        "{minutes} of solid focus! You're a lion today. 🦁",
        "{minutes} of deep work. Swamiji would approve!",
    ],
    "its_work": [
        "Got it! I'll remember {label} is work for you.",
        "Noted! {label} is on the work list now.",
    ],
    "poke": [
        "Hehe, that tickles!",
        "Rawr! That's lion for hello.",
        "Yes? I'm all ears. And mane.",
        "Boop! Want a quote? Click again for my menu.",
    ],
    "hush": [
        "Shh... I'll stay quiet for {minutes}. Holler if you need me.",
    ],
    "onboarding": [
        "Hi! I'm Leo. Tell me your name and goals on the dashboard so I can help you focus.",
    ],
}

_FALLBACK_CHAT = [
    "My thinking cap is napping right now, but I believe in you! Want a quote?",
    "My thinking cap is offline, but my cheering paws work fine. You've got this!",
]


def fmt_minutes(seconds: float) -> str:
    m = int(round(seconds / 60))
    if seconds < 60:
        return f"{int(seconds)} seconds"
    return "1 minute" if m <= 1 else f"{m} minutes"


def template(kind: str, rng: random.Random, **fields: Any) -> str:
    options = TEMPLATES.get(kind) or [""]
    line = rng.choice(options)
    try:
        return line.format(**fields)
    except (KeyError, IndexError):
        return line


# ------------------------------------------------------------------------- ollama
_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


class Brain:
    """Thin async client for the local model. Every call degrades to None on failure."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.online: Optional[bool] = None
        self._buddy_model_ok: Optional[bool] = None
        self._checked_at = 0.0

    async def _model(self) -> str:
        # re-check now and then: the viveka-leo model may be created after the backend starts
        if self._buddy_model_ok is None or (not self._buddy_model_ok and time.monotonic() - self._checked_at > 300):
            self._checked_at = time.monotonic()
            try:
                async with httpx.AsyncClient(timeout=3.0) as c:
                    r = await c.get(f"{self.settings.ollama_url}/api/tags")
                names = {m.get("name") for m in r.json().get("models", []) if isinstance(m, dict)}
                want = self.settings.buddy_model
                self._buddy_model_ok = want in names or f"{want}:latest" in names
            except (httpx.HTTPError, ValueError, AttributeError):
                return self.settings.llm_model
        return self.settings.buddy_model if self._buddy_model_ok else self.settings.llm_model

    async def generate(self, system: str, prompt: str, *, timeout: float, num_predict: int = 80,
                       temperature: float = 0.8, fmt: Optional[dict[str, Any]] = None,
                       persona_model: bool = True) -> Optional[str]:
        body: dict[str, Any] = {
            "model": await self._model() if persona_model else self.settings.llm_model,
            "system": system,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "keep_alive": "30m",
            "options": {"temperature": temperature, "num_predict": num_predict},
        }
        if fmt:
            body["format"] = fmt
        try:
            async with httpx.AsyncClient(timeout=timeout) as c:
                r = await c.post(f"{self.settings.ollama_url}/api/generate", json=body)
            if r.status_code >= 300:
                self.online = False
                return None
            text = r.json().get("response")
        except (httpx.HTTPError, ValueError, AttributeError) as exc:
            logger.debug("ollama call failed: %s", exc)
            self.online = False
            return None
        self.online = True
        if not isinstance(text, str):
            return None
        return _THINK.sub("", text).strip() or None

    # ---------------------------------------------------------------- tasks
    async def line(self, kind: str, *, name: str, age: Optional[int], goal: str, label: str, minutes: str,
                   title: str = "", place: str = "tab", personality: str = "playful",
                   timeout: float = 6.0) -> Optional[str]:
        situations = {
            "distraction1": f"{name} has been on {label} for {minutes} instead of working on '{goal}'. "
                            f"Gently and playfully tell them this looks like the wrong {place} for their goal "
                            "and invite them back.",
            "distraction2": f"{name} is STILL on {label} after {minutes}, instead of '{goal}'. Kindly say it is still "
                            f"the wrong {place}; be a bit firmer but warm and funny. Mention being a lion, not a sheep.",
            "stall3": f"{name} was writing in {label} for '{goal}' but has not typed anything for {minutes}. "
                      "Gently tell them they seem distracted and suggest one tiny next step or a short break.",
        }
        if kind not in situations:
            return None
        who = f"{name}" + (f" (age {age})" if age else "")
        prompt = (f"User: {who}. Goal: {goal}.\n" + (f"Window title: {title[:80]}\n" if title else "") +
                  f"Situation: {situations[kind]}\nReply with ONE sentence under 24 words, speaking directly to {name} "
                  f"(call them {name}; Swamiji is Swami Vivekananda, never the user). No quotation marks.")
        # a little cooler than chat: short alert lines from a small model drift into nonsense when too "creative"
        text = await self.generate(persona(personality), prompt, timeout=timeout, num_predict=70, temperature=0.6)
        if not text:
            return None
        line = brief(clean_line(text))
        return line if acceptable_line(line, name) else None

    async def classify(self, activity: Activity, goals: list[str], work: list[str], distractions: list[str],
                       timeout: float = 20.0) -> Optional[Verdict]:
        system = (
            "You decide whether the user's current screen activity serves their goals. Reply ONLY with JSON "
            '{"verdict": "focus" | "neutral" | "distraction", "category": "<one word>", "reason": "<short, kind sentence>"}. '
            "focus = directly helps a goal (learning material on the goal's topic counts). neutral = unclear, "
            "communication, or quick utility. distraction = entertainment, social feeds, shopping or anything "
            "unrelated to every goal. Judge by the title: the same site can help or distract."
        )
        prompt = (
            f"GOALS: {'; '.join(goals)[:300]}\n"
            f"USUAL DISTRACTIONS: {', '.join(distractions)[:150] or 'none listed'}\n"
            f"WORK TOOLS: {', '.join(work)[:150] or 'none listed'}\n"
            f"APP: {activity.app[:60] or 'web browser'}\n"
            + (f"SITE: {activity.domain}\n" if activity.domain else "")
            + f"TITLE: {activity.title[:140] or '(none)'}"
        )
        schema = {
            "type": "object",
            "properties": {"verdict": {"type": "string", "enum": ["focus", "neutral", "distraction"]},
                           "category": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["verdict", "category", "reason"],
        }
        text = await self.generate(system, prompt, timeout=timeout, num_predict=90, temperature=0.0, fmt=schema,
                                   persona_model=False)
        if not text:
            return None
        try:
            data = json.loads(text[text.index("{"): text.rindex("}") + 1])
        except ValueError:
            return None
        kind = data.get("verdict")
        if kind not in ("focus", "neutral", "distraction"):
            return None
        cat = re.sub(r"[^A-Za-z]", "", str(data.get("category", "")).split()[0] if data.get("category") else "")
        return Verdict(kind, (cat[:1].upper() + cat[1:].lower()) or "Other",
                       str(data.get("reason", ""))[:160] or "Judged by your local model.", source="llm")

    async def chat(self, message: str, history: list[dict[str, str]], context: str, timeout: float = 25.0,
                   personality: str = "playful") -> str:
        convo = "\n".join(f"{'User' if h['role'] == 'user' else 'Leo'}: {h['text']}" for h in history[-6:])
        system = (persona(personality) + " Answer in at most 3 short sentences. If asked about Swami Vivekananda, be accurate and "
                  "humble; do not invent quotes. You can suggest a focus sprint or a break. Context about the user: "
                  + context)
        text = await self.generate(system, (convo + "\n" if convo else "") + f"User: {message}\nLeo:",
                                   timeout=timeout, num_predict=160, temperature=0.7)
        return clean_line(text, limit=420) if text else random.choice(_FALLBACK_CHAT)


_EMOJI = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF]\uFE0F?")


def _one_emoji(text: str) -> str:
    """Leo's style: at most one emoji per line (keep the first)."""
    seen = False

    def keep(m: re.Match[str]) -> str:
        nonlocal seen
        if seen:
            return ""
        seen = True
        return m.group(0)

    return re.sub(r"\s{2,}", " ", _EMOJI.sub(keep, text)).strip()


_WRONG_ADDRESS = re.compile(r"\b(hey|hi|hello|oh|dear|ok(ay)?|psst|namaste)[,!]?\s+swami(ji)?\b|^swami(ji)?[,!]", re.I)


def acceptable_line(line: str, name: str) -> bool:
    """Reject model slips such as addressing the user as 'Swami' or answering for the wrong person."""
    if len(line) < 12 or _WRONG_ADDRESS.search(line):
        return False
    other_names = re.findall(r"^(?i:hey|hi|hello|psst|okay|oh)[,!]?\s+([A-Z][a-z]+)", line)
    return not other_names or other_names[0].lower() == name.split()[0].lower()


def brief(line: str, max_words: int = 26) -> str:
    """Small models ignore "one short sentence": keep whole sentences up to ~max_words (at least one)."""
    if len(line.split()) <= max_words:
        return line
    parts = re.split(r"(?<=[.!?])\s+", line)
    kept: list[str] = []
    for i, part in enumerate(parts):
        lead = _EMOJI.match(part)
        if kept and lead:  # an emoji that followed the previous sentence belongs to it
            kept[-1] += " " + lead.group(0)
            part = part[lead.end():].strip()
        if kept and len(" ".join(kept + [part]).split()) > max_words:
            break
        if part:
            kept.append(part)
    return " ".join(kept).strip()


def clean_line(text: str, limit: int = 220) -> str:
    t = re.sub(r"^(Leo|Assistant)\s*:\s*", "", _THINK.sub("", text).strip(), flags=re.I)
    t = _one_emoji(t.strip().strip('"“”').strip())
    t = re.sub(r"\s+", " ", t)
    if len(t) > limit:
        cut = t[:limit]
        t = cut[: max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? ")) + 1] or cut.rstrip() + "…"
    return t
