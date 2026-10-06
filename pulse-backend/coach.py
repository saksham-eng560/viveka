"""The coach engine behind Sheru: turns screen signals into gentle, well-timed messages.

Inputs
  * desktop samples from the macOS buddy app every ~2s: frontmost app, window title,
    seconds since the last key press and since any input, screen lock;
  * browser samples from the extension: active tab URL/title, audible, window focus.

Every tick (1s) the coach resolves "what is on screen", judges it against the user's
goals (rules first, local LLM for ambiguous cases), logs it, and runs four detectors:

  distraction  off-goal app/site for a while  -> playful alert, then a firmer one
  stall        stopped typing in a writing app -> nudge, nudge, "you seem distracted"
  storm        rapid hopping between apps/sites -> "pick one thing"
  wisdom       quiet moments -> a Vivekananda quote or fact

All timings come from the user's chosen pace (gentle / balanced / demo).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import logging
import random
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Optional

from activity_store import ActivityStore, Segment
from catalog import Activity, Verdict, domain_of, domain_from_browser_title, heuristic_verdict, is_browser, is_system
from config import Settings
from persona import Brain, fmt_minutes, template
from profile_store import Profile, ProfileStore
from vivekananda import Wisdom, WisdomPicker

logger = logging.getLogger("pulse.coach")


@dataclass(frozen=True)
class Pace:
    distraction: float  # seconds off-goal before the first alert
    repeat: float  # seconds between follow-up alerts
    stall: float  # seconds without typing (in a writing app) per nudge level
    afk: float  # seconds without any input before Sheru naps
    snooze: float  # "2 more minutes" length
    storm_window: float
    storm_count: int
    streak: float  # celebrate this much continuous focus
    wisdom_gap: float  # seconds between ambient quotes/facts
    break_len: float
    hush: float
    headsup: float = 4.0  # seconds on an off-goal tab/app before the gentle "wrong tab?" note
    headsup_cooldown: float = 180.0  # don't repeat that note for the same site/app within this window


PACES: dict[str, Pace] = {
    "gentle": Pace(120, 600, 180, 300, 300, 120, 10, 45 * 60, 25 * 60, 300, 3600, headsup=12, headsup_cooldown=600),
    "balanced": Pace(45, 300, 90, 300, 180, 120, 8, 25 * 60, 12 * 60, 300, 1800, headsup=4, headsup_cooldown=180),
    "demo": Pace(10, 40, 15, 90, 25, 40, 6, 180, 75, 60, 120, headsup=2, headsup_cooldown=40),
}
WISDOM_MULT = {"often": 0.5, "sometimes": 1.0, "rarely": 2.5}

DESKTOP_FRESH = 8.0
BROWSER_FRESH = 120.0


@dataclass
class DesktopSample:
    app: str = ""
    bundle_id: str = ""
    title: str = ""
    key_idle: float = 0.0
    input_idle: float = 0.0
    locked: bool = False
    ax_trusted: bool = False


@dataclass
class BrowserSample:
    url: str = ""
    title: str = ""
    audible: bool = False
    focused: bool = True
    incognito: bool = False
    tab_id: int = -1
    browser: str = "Chrome"


@dataclass
class Message:
    id: int
    kind: str  # greeting | quote | fact | distraction | stall | back | celebrate | info | chat | storm | break
    mood: str  # wave | talk | happy | alert | worried | think | sleep | celebrate | wisdom
    text: str
    title: str = ""
    source: str = ""
    actions: list[dict[str, str]] = field(default_factory=list)
    ttl: Optional[float] = 14.0  # None: stays until acted on
    level: int = 0
    label: str = ""
    ts: float = 0.0

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        d["alert"] = self.ttl is None
        return d


ACT_BACK = {"id": "back_to_work", "label": "Back to work"}
ACT_SNOOZE = {"id": "snooze", "label": "2 more min"}
ACT_ITS_WORK = {"id": "its_work", "label": "It's for work"}
ACT_BREAK = {"id": "break", "label": "Take a break"}
ACT_OK = {"id": "dismiss", "label": "Got it"}


class Coach:
    def __init__(self, settings: Settings, profiles: ProfileStore, store: ActivityStore, brain: Brain,
                 clock: Callable[[], float] = time.time, rng: Optional[random.Random] = None) -> None:
        self.settings = settings
        self.profiles = profiles
        self.store = store
        self.brain = brain
        self.clock = clock
        self.rng = rng or random.Random()
        self.wisdom = WisdomPicker(self.rng)
        self.messages: deque[Message] = deque(maxlen=60)
        self._next_id = 1
        self.desktop: Optional[DesktopSample] = None
        self.desktop_at = 0.0
        self.browser: Optional[BrowserSample] = None
        self.browser_at = 0.0
        self.chat_history: list[dict[str, str]] = []
        self.extension_commands: list[dict[str, Any]] = []
        self._llm_cache: dict[str, Verdict] = {}
        self._llm_pending: set[str] = set()
        self._lines: dict[str, str] = {}
        self._tasks: set[asyncio.Task[Any]] = set()
        self._llm_sem: Optional[asyncio.Semaphore] = None
        self._today_cache: tuple[float, dict[str, Any]] = (0.0, {})
        self.reset_session()

    # ------------------------------------------------------------------ state
    def reset_session(self) -> None:
        now = self.clock()
        self.activity: Optional[Activity] = None
        self.verdict: Optional[Verdict] = None
        self.ctx_key: Optional[str] = None
        self.ctx_since = now
        self.segment_id: Optional[int] = None
        self.segment_ident: Optional[tuple[str, str]] = None
        self.segment_flushed = now
        self.away = False
        self.away_since: Optional[float] = None
        self.dist_since: Optional[float] = None
        self.dist_last_tick = 0.0
        self.dist_level = 0
        self.dist_last_alert = 0.0
        self.dist_episode = 0
        self.headsup_episode = -1
        self.headsup_at: dict[str, float] = {}
        self.stall_level = 0
        self.stall_last_alert = 0.0
        self.active_alert: Optional[int] = None
        self.snooze_until = 0.0
        self.break_until = 0.0
        self.hush_until = 0.0
        self.focus_since: Optional[float] = None
        self.last_streak = now
        self.last_wisdom = now
        self.last_message_at = 0.0
        self.last_back_at = 0.0
        self.last_storm = 0.0
        self.switches: deque[float] = deque()
        self.greeted = False
        self.last_focus_activity: Optional[Activity] = None
        self.last_focus_bundle: str = ""

    @property
    def profile(self) -> Optional[Profile]:
        return self.profiles.load()

    @property
    def pace(self) -> Pace:
        p = self.profile
        return PACES.get(p.pace if p else "balanced", PACES["balanced"])

    def buddy_online(self, now: Optional[float] = None) -> bool:
        return self.desktop is not None and (now or self.clock()) - self.desktop_at <= DESKTOP_FRESH * 2

    def extension_online(self, now: Optional[float] = None) -> bool:
        return self.browser is not None and (now or self.clock()) - self.browser_at <= BROWSER_FRESH

    # ----------------------------------------------------------------- inputs
    def ingest_desktop(self, sample: DesktopSample) -> None:
        self.desktop, self.desktop_at = sample, self.clock()

    def ingest_browser(self, sample: BrowserSample) -> dict[str, Any]:
        now = self.clock()
        self.browser, self.browser_at = sample, now
        act = self._activity_from_browser(sample)
        verdict = self._judge(act) if act and self.profile else None
        if not self.buddy_online(now):
            self.tick()  # no desktop app: the browser drives the engine
        alert = None
        if not self.buddy_online(now):  # no desktop app: the extension shows Sheru's messages inside the page
            alert = self._find(self.active_alert) if self.active_alert else None
            if alert is None and self.verdict is not None and self.verdict.kind == "distraction":
                heads_up = next((m for m in reversed(self.messages) if m.kind == "nudge"), None)
                if heads_up is not None and now - heads_up.ts <= 15:
                    alert = heads_up
        commands, self.extension_commands = self.extension_commands, []
        return {
            "verdict": None if verdict is None else {
                "kind": verdict.kind, "score": verdict.score, "category": verdict.category,
                "reason": verdict.reason, "source": verdict.source,
            },
            "buddyOnline": self.buddy_online(now),
            "alert": alert.public() if alert else None,
            "commands": commands,
            "profile": self._profile_brief(),
        }

    # ------------------------------------------------------------- resolution
    @staticmethod
    def _activity_from_browser(b: BrowserSample) -> Optional[Activity]:
        if b.incognito:
            return Activity(app="Private window", bundle_id="private-browsing")
        domain = domain_of(b.url)
        if not domain:
            return Activity(app=b.browser or "Browser", bundle_id="browser-internal", title=b.title)
        return Activity(app=b.browser or "Browser", url=b.url, domain=domain, title=b.title)

    def _current_activity(self, now: float) -> Optional[Activity]:
        d = self.desktop if self.desktop and now - self.desktop_at <= DESKTOP_FRESH else None
        b = self.browser if self.browser and now - self.browser_at <= BROWSER_FRESH else None
        if d is not None:
            if d.locked:
                return None
            act = Activity(app=d.app, bundle_id=d.bundle_id, title=d.title)
            if is_browser(act):
                if b is not None and b.focused and self._same_page(d, b):
                    web = self._activity_from_browser(b)
                    return web if web is not None else act
                guess = domain_from_browser_title(d.title)
                if guess:
                    return Activity(app=d.app, bundle_id=d.bundle_id, title=d.title, domain=guess)
            return act
        if b is not None and b.focused:
            return self._activity_from_browser(b)
        return None

    @staticmethod
    def _same_page(d: DesktopSample, b: BrowserSample) -> bool:
        if not d.title:
            return True
        probe = b.title.strip().lower()[:24]
        return not probe or probe in d.title.lower()

    def _goal_hash(self) -> str:
        p = self.profile
        raw = "|".join((p.goals + p.work_tools + p.distractions) if p else [])
        return hashlib.sha1(raw.encode()).hexdigest()[:10]

    def _judge(self, act: Activity) -> Verdict:
        p = self.profile
        if p is None:
            return Verdict("neutral", "Unknown", "No goals set yet.")
        if act.bundle_id in ("private-browsing", "browser-internal"):
            return Verdict("neutral", "Browser", "A browser page.", source="rule")
        v = heuristic_verdict(act, p.goals, p.work_tools, p.distractions, p.overrides)
        if not v.ambiguous:
            return v
        ck = f"{self._goal_hash()}|{act.key}|{act.title.lower()[:140]}"
        cached = self._llm_cache.get(ck)
        if cached is not None:
            return Verdict(cached.kind, cached.category, cached.reason, writing=v.writing, source="llm")
        self._schedule_classify(ck, act)
        return v

    # ------------------------------------------------------------ LLM plumbing
    def _spawn(self, coro: Any) -> bool:
        if not self.settings.llm_classify:
            coro.close()
            return False
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            coro.close()
            return False
        task = loop.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    def _schedule_classify(self, ck: str, act: Activity) -> None:
        if ck in self._llm_pending or len(self._llm_pending) > 12:
            return
        p = self.profile
        if p is None:
            return

        async def run() -> None:
            self._llm_sem = self._llm_sem or asyncio.Semaphore(1)
            try:
                async with self._llm_sem:
                    v = await self.brain.classify(act, p.goals, p.work_tools, p.distractions)
                if v is not None:
                    if len(self._llm_cache) > 600:
                        self._llm_cache.pop(next(iter(self._llm_cache)))
                    self._llm_cache[ck] = v
            finally:
                self._llm_pending.discard(ck)

        self._llm_pending.add(ck)
        if not self._spawn(run()):
            self._llm_pending.discard(ck)

    def _prepare_line(self, slot: str, kind: str, label: str, minutes: str, title: str = "", place: str = "tab") -> None:
        p = self.profile
        if p is None or slot in self._lines:
            return

        async def run() -> None:
            line = await self.brain.line(kind, name=p.first_name, age=p.age, goal=p.main_goal, label=label,
                                         minutes=minutes, title=title, place=place)
            if line:
                self._lines[slot] = line
                if len(self._lines) > 40:
                    self._lines.pop(next(iter(self._lines)))

        self._spawn(run())

    # --------------------------------------------------------------- messages
    def _push(self, kind: str, mood: str, text: str, **kw: Any) -> Message:
        now = self.clock()
        msg = Message(id=self._next_id, kind=kind, mood=mood, text=text, ts=now, **kw)
        self._next_id += 1
        self.messages.append(msg)
        self.last_message_at = now
        if msg.ttl is None:
            self.active_alert = msg.id
        if kind in ("distraction", "stall", "nudge"):
            try:
                self.store.log_alert(now, kind, msg.level, msg.label, text)
            except Exception:  # pragma: no cover - logging must never break the coach
                logger.exception("could not log alert")
        return msg

    def _find(self, msg_id: Optional[int]) -> Optional[Message]:
        return next((m for m in self.messages if m.id == msg_id), None)

    def _fields(self, label: str = "", seconds: float = 0) -> dict[str, Any]:
        p = self.profile
        return {"name": p.first_name if p else "friend", "goal": p.main_goal if p else "your goal",
                "label": label, "minutes": fmt_minutes(seconds)}

    def _wisdom_message(self, w: Wisdom, intro: str = "", ttl: float = 20.0) -> Message:
        title = intro or ("Swamiji says" if w.kind == "quote" else "Did you know?")
        return self._push(w.kind, "wisdom", w.text, title=title, source=w.source, ttl=ttl)

    def greet(self) -> None:
        p = self.profile
        if p is None:
            self._push("info", "wave", template("onboarding", self.rng),
                       actions=[{"id": "open_onboarding", "label": "Set my goals"}], ttl=30)
        else:
            self._push("greeting", "wave", template("greeting", self.rng, **self._fields()), title="Hello!", ttl=16)
            w = self.wisdom.quote("start")
            self._push("quote", "wisdom", w.text, title="To start the day", source=w.source, ttl=20)
        self.greeted = True
        self.last_wisdom = self.clock()

    def on_profile_saved(self) -> None:
        self._llm_cache.clear()
        self.reset_session()
        self.greet()

    # ------------------------------------------------------------------- tick
    def tick(self) -> None:
        now = self.clock()
        p = self.profile
        if not self.greeted and (self.buddy_online(now) or self.extension_online(now)):
            self.greet()
        if p is None:
            return
        pace = self.pace
        d = self.desktop if self.desktop and now - self.desktop_at <= DESKTOP_FRESH else None

        # ---- away / back
        idle = d.input_idle if d else 0.0
        locked = bool(d and d.locked)
        if d is not None and (locked or idle >= pace.afk):
            if not self.away:
                self.away, self.away_since = True, now - (0 if locked else idle)
                self._close_segment(now - (0 if locked else idle))
                self._clear_alert()
            return
        if self.away:
            self.away = False
            if self.away_since and now - self.away_since >= pace.afk:
                self._push("info", "wave", template("away_back", self.rng, **self._fields()), ttl=12)
            self.away_since = None
            self.dist_since, self.stall_level = None, 0
            self.focus_since = now

        act = self._current_activity(now)
        if act is None:
            self._close_segment(now)
            return
        verdict = self._judge(act)
        self._track_context(act, verdict, now)

        on_break = now < self.break_until
        if self.break_until and not on_break:
            self.break_until = 0.0
            self._push("break", "wave", template("break_end", self.rng, **self._fields()), ttl=20,
                       actions=[ACT_OK])
        hushed = now < self.hush_until
        quiet = on_break or hushed

        self._distraction(act, verdict, now, pace, quiet)
        if d is not None:
            self._stall(act, verdict, d, now, pace, quiet)
        if not quiet:
            self._streak(verdict, now, pace)
            self._ambient(verdict, d, now, pace)

    # ---------------------------------------------------------- segment/log
    def _track_context(self, act: Activity, verdict: Verdict, now: float) -> None:
        if act.key != self.ctx_key:
            if self.ctx_key is not None and not is_system(act):
                self.switches.append(now)
            self.ctx_key, self.ctx_since = act.key, now
            self.stall_level = 0
            self._storm(now)
        ident = (act.key, verdict.kind)
        if ident != self.segment_ident:
            self._close_segment(now)  # before self.verdict moves on: the old segment keeps its own verdict
        self.activity, self.verdict = act, verdict
        if verdict.kind == "focus":
            self.last_focus_activity = act
            if self.desktop is not None and now - self.desktop_at <= DESKTOP_FRESH:
                self.last_focus_bundle = self.desktop.bundle_id
        if ident != self.segment_ident:
            p = self.profile
            try:
                self.segment_id = self.store.open_segment(Segment(
                    start=now, end=now, key=act.key, label=act.label, app=act.app, domain=act.domain,
                    url=act.url, title=act.title, verdict=verdict.kind, category=verdict.category,
                    reason=verdict.reason, goal=p.main_goal if p else None))
            except Exception:  # pragma: no cover
                logger.exception("could not open segment")
                self.segment_id = None
            self.segment_ident = ident
            self.segment_flushed = now
        elif self.segment_id is not None and now - self.segment_flushed >= 5:
            self._flush_segment(now)

    def _flush_segment(self, now: float) -> None:
        if self.segment_id is None:
            return
        try:
            v = self.verdict
            self.store.extend_segment(self.segment_id, now, v.kind if v else None, v.category if v else None,
                                      v.reason if v else None)
        except Exception:  # pragma: no cover
            logger.exception("could not extend segment")
        self.segment_flushed = now

    def _close_segment(self, now: float) -> None:
        if self.segment_id is not None:
            self._flush_segment(max(now, self.segment_flushed))
        self.segment_id, self.segment_ident = None, None

    # ------------------------------------------------------------- detectors
    def _clear_alert(self) -> None:
        self.active_alert = None

    def _distraction(self, act: Activity, verdict: Verdict, now: float, pace: Pace, quiet: bool) -> None:
        if verdict.kind == "focus":
            if self.dist_level > 0 and now - self.last_back_at > 60:
                self.last_back_at = now
                self._push("back", "celebrate", template("back", self.rng, **self._fields()), ttl=8)
            if self.active_alert is not None:
                msg = self._find(self.active_alert)
                if msg is not None and msg.kind == "distraction":
                    self._clear_alert()
            self.dist_since, self.dist_level = None, 0
            if self.focus_since is None:
                self.focus_since = now
            return
        if verdict.kind == "neutral":
            if self.dist_since is not None and now - self.dist_last_tick > 60:
                self.dist_since = None
            return
        # distraction
        self.focus_since = None
        if self.dist_since is None:
            self.dist_since = now
            self.dist_episode += 1
            self._prepare_line(f"d{self.dist_episode}-1", "distraction1", act.label, fmt_minutes(pace.distraction),
                               act.title, place=self._place(act))
        self.dist_last_tick = now
        if quiet or now < self.snooze_until:
            return
        spent = now - self.dist_since
        self._heads_up(act, verdict, now, pace, spent)
        level = 0
        if self.dist_level == 0 and spent >= pace.distraction:
            level = 1
        elif self.dist_level >= 1 and now - self.dist_last_alert >= pace.repeat:
            level = 2
        if not level:
            return
        slot = f"d{self.dist_episode}-{min(self.dist_level + 1, 2)}"
        line = self._lines.pop(slot, None) or template(f"distraction{level}", self.rng,
                                                       **self._fields(act.label, spent))
        title = "Psst!" if level == 1 else "Focus check"
        self._push("distraction", "alert" if level == 1 else "worried", line, title=title, level=level,
                   label=act.label, ttl=None, actions=[ACT_BACK, ACT_SNOOZE, ACT_ITS_WORK],
                   source=self._why(verdict))
        self.dist_level += 1
        self.dist_last_alert = now
        self._prepare_line(f"d{self.dist_episode}-2", "distraction2", act.label, fmt_minutes(spent + pace.repeat),
                           act.title, place=self._place(act))

    @staticmethod
    def _place(act: Activity) -> str:
        return "tab" if act.is_web else "window"

    @staticmethod
    def _why(verdict: Verdict) -> str:
        return f"Why: {verdict.reason}" if verdict.reason else ""

    def _heads_up(self, act: Activity, verdict: Verdict, now: float, pace: Pace, spent: float) -> None:
        """A soft "wrong tab?" note shortly after landing on something off-goal, well before any real alert."""
        if self.dist_level > 0 or self.headsup_episode == self.dist_episode or spent < pace.headsup:
            return
        # an ambiguous site (e.g. YouTube) may still be judged "on goal" by the model: give it a few seconds
        settled = not verdict.ambiguous or verdict.source == "llm" or not self.settings.llm_classify or spent >= 6
        if not settled:
            return
        self.headsup_episode = self.dist_episode
        if now - self.headsup_at.get(act.key, -1e12) < pace.headsup_cooldown:
            return  # we mentioned this very site a moment ago; the escalation alerts take it from here
        self.headsup_at[act.key] = now
        place = self._place(act)
        self._push("nudge", "think", template("headsup", self.rng, **{**self._fields(act.label, spent), "place": place}),
                   title=f"Wrong {place}?", source=self._why(verdict), label=act.label, ttl=12,
                   actions=[ACT_BACK, ACT_ITS_WORK])

    def _stall(self, act: Activity, verdict: Verdict, d: DesktopSample, now: float, pace: Pace, quiet: bool) -> None:
        key_idle = d.key_idle
        if key_idle < 3:
            if self.stall_level >= 1 and now - self.last_back_at > 30:
                self.last_back_at = now
                self._push("back", "happy", template("typing_again", self.rng, **self._fields()), ttl=6)
                msg = self._find(self.active_alert)
                if msg is not None and msg.kind == "stall":
                    self._clear_alert()
            self.stall_level = 0
            return
        if quiet or now < self.snooze_until or not verdict.writing or verdict.kind == "distraction":
            return
        if key_idle > 20 * 60 or self.stall_level >= 3:
            return  # not writing at all lately, or already said our piece
        in_ctx = now - self.ctx_since
        want = self.stall_level + 1
        if key_idle < pace.stall * want or in_ctx < min(pace.stall, 60):
            return
        if now - self.stall_last_alert < pace.stall * 0.8:
            return
        self.stall_level = want
        self.stall_last_alert = now
        fields = self._fields(act.label, key_idle)
        if want == 1:
            w = self.wisdom.quote("stuck")
            self._push("stall", "think", template("stall1", self.rng, **fields), title="Thinking pause?",
                       level=1, label=act.label, ttl=22, actions=[ACT_OK])
            self._push("quote", "wisdom", w.text, title="A little fuel", source=w.source, ttl=20)
        elif want == 2:
            self._push("stall", "think", template("stall2", self.rng, **fields), title="Still stuck?",
                       level=2, label=act.label, ttl=25, actions=[ACT_OK, ACT_BREAK])
            self._prepare_line(f"s{int(self.ctx_since)}-3", "stall3", act.label, fmt_minutes(pace.stall * 3), act.title)
        else:
            line = self._lines.pop(f"s{int(self.ctx_since)}-3", None) or template("stall3", self.rng, **fields)
            self._push("stall", "worried", line, title="You seem distracted", level=3, label=act.label, ttl=None,
                       actions=[{"id": "dismiss", "label": "I'm back"}, ACT_BREAK, ACT_SNOOZE])

    def _storm(self, now: float) -> None:
        pace = self.pace
        while self.switches and now - self.switches[0] > pace.storm_window:
            self.switches.popleft()
        if len(self.switches) >= pace.storm_count and now - self.last_storm > max(pace.storm_window * 3, 60):
            if now < self.hush_until or now < self.break_until:
                return
            self.last_storm = now
            self.switches.clear()
            self._push("storm", "think", template("storm", self.rng, **self._fields()), title="Hop, hop, hop!",
                       ttl=14)

    def _streak(self, verdict: Verdict, now: float, pace: Pace) -> None:
        if verdict.kind != "focus" or self.focus_since is None:
            return
        if now - self.focus_since >= pace.streak and now - self.last_streak >= pace.streak:
            self.last_streak = now
            mins = now - self.focus_since
            self._push("celebrate", "celebrate", template("streak", self.rng, **self._fields("", mins)),
                       title="Focus streak!", ttl=12)

    def _ambient(self, verdict: Verdict, d: Optional[DesktopSample], now: float, pace: Pace) -> None:
        p = self.profile
        gap = pace.wisdom_gap * WISDOM_MULT.get(p.quotes if p else "sometimes", 1.0)
        if now - self.last_wisdom < gap or now - self.last_message_at < 30 or self.active_alert is not None:
            return
        if verdict.kind == "distraction" or (d is not None and d.key_idle < 6):
            return
        self.last_wisdom = now
        self._wisdom_message(self.wisdom.any())

    # ---------------------------------------------------------------- actions
    def action(self, action: str, message_id: Optional[int] = None, minutes: Optional[float] = None) -> dict[str, Any]:
        now = self.clock()
        pace = self.pace
        out: dict[str, Any] = {"ok": True, "activate": None, "message": None}
        msg = self._find(message_id) if message_id else self._find(self.active_alert)
        if message_id is None or message_id == self.active_alert:
            self._clear_alert()
        fields = self._fields(self.activity.label if self.activity else "")

        def say(kind: str, mood: str, text: str, **kw: Any) -> None:
            out["message"] = self._push(kind, mood, text, **kw).public()

        if action == "dismiss":
            if msg is not None and msg.kind in ("distraction", "stall"):
                self.snooze_until = now + pace.snooze
        elif action == "snooze":
            self.snooze_until = now + pace.snooze
            say("info", "happy", template("snooze", self.rng, **{**fields, "minutes": fmt_minutes(pace.snooze)}), ttl=6)
        elif action == "back_to_work":
            self.snooze_until = now + min(pace.snooze, 30)
            target = self.last_focus_activity
            if target is not None and target.is_web and target.url:
                self.extension_commands.append({"type": "focusUrl", "url": target.url})
            bundle = self.last_focus_bundle if target is not None else ""
            if bundle:
                out["activate"] = {"bundleId": bundle}
            say("back", "celebrate", template("back", self.rng, **fields), ttl=6)
        elif action == "its_work":
            act = self.activity
            if act is not None and self.profiles.set_override(act.key, "focus"):
                self._llm_cache.clear()
                self.dist_since, self.dist_level = None, 0
                say("info", "happy", template("its_work", self.rng, **fields), ttl=8)
        elif action == "break":
            length = (minutes * 60) if minutes else pace.break_len
            self.break_until = now + length
            self.dist_since, self.stall_level = None, 0
            say("break", "sleep", template("break_start", self.rng, **{**fields, "minutes": fmt_minutes(length)}),
                ttl=10)
        elif action == "hush":
            length = (minutes * 60) if minutes else pace.hush
            self.hush_until = now + length
            say("info", "sleep", template("hush", self.rng, **{**fields, "minutes": fmt_minutes(length)}), ttl=6)
        elif action == "resume":
            self.hush_until = self.break_until = self.snooze_until = 0.0
            say("info", "happy", "I'm back on watch! Let's go.", ttl=5)
        elif action == "quote":
            out["message"] = self._wisdom_message(self.wisdom.quote(), ttl=24).public()
            self.last_wisdom = now
        elif action == "fact":
            out["message"] = self._wisdom_message(self.wisdom.fact(), ttl=24).public()
            self.last_wisdom = now
        elif action == "poke":
            say("info", "happy", template("poke", self.rng, **fields), ttl=4)
        elif action == "open_onboarding":
            pass
        else:
            out["ok"] = False
        return out

    async def chat(self, text: str) -> dict[str, Any]:
        text = text.strip()[:400]
        p = self.profile
        ctx = "unknown"
        if p is not None:
            now_doing = f"{self.activity.label} ({self.verdict.kind})" if self.activity and self.verdict else "unknown"
            today = self.today()
            ctx = (f"name {p.first_name}" + (f", age {p.age}" if p.age else "") + f"; goals: {'; '.join(p.goals)}; "
                   f"currently on: {now_doing}; focused {today.get('focusSeconds', 0) // 60} min and distracted "
                   f"{today.get('distractionSeconds', 0) // 60} min today.")
        lower = text.lower()
        if lower in ("quote", "a quote", "give me a quote", "inspire me"):
            w = self.wisdom.quote()
            reply = f"“{w.text}” — Swami Vivekananda"
        elif lower in ("fact", "a fact", "tell me a fact"):
            reply = self.wisdom.fact().text
        else:
            reply = await self.brain.chat(text, self.chat_history, ctx)
        self.chat_history += [{"role": "user", "text": text}, {"role": "sheru", "text": reply}]
        self.chat_history = self.chat_history[-12:]
        return {"reply": reply, "mood": "talk"}

    # ------------------------------------------------------------------ views
    def _profile_brief(self) -> Optional[dict[str, Any]]:
        p = self.profile
        if p is None:
            return None
        return {"name": p.name, "firstName": p.first_name, "goals": p.goals, "pace": p.pace, "voice": p.voice,
                "sounds": p.sounds, "quotes": p.quotes}

    def mood(self, now: float) -> str:
        if self.profile is None:
            return "wave"
        if self.away:
            return "sleep"
        if now < self.break_until:
            return "break"
        alert = self._find(self.active_alert)
        if alert is not None:
            return alert.mood
        if self.stall_level:
            return "think"
        d = self.desktop
        if self.verdict is not None and self.verdict.kind == "focus" and d is not None and d.key_idle < 5:
            return "focus"
        return "idle"

    def today(self) -> dict[str, Any]:
        now = self.clock()
        if now - self._today_cache[0] < 10 and self._today_cache[1]:
            return self._today_cache[1]
        start = dt.datetime.fromtimestamp(now).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        try:
            stats = self.store.today_stats(start, now + 1)
        except Exception:  # pragma: no cover
            logger.exception("today stats failed")
            stats = {}
        self._today_cache = (now, stats)
        return stats

    def state(self, since: int = 0) -> dict[str, Any]:
        now = self.clock()
        act, v = self.activity, self.verdict
        d = self.desktop
        today = self.today()
        return {
            "profile": self._profile_brief(),
            "mood": self.mood(now),
            "now": None if act is None or v is None or self.away else {
                "label": act.label, "app": act.app, "title": act.title[:120], "domain": act.domain,
                "verdict": v.kind, "category": v.category, "reason": v.reason, "source": v.source,
                "writing": v.writing, "keyIdle": round(d.key_idle, 1) if d else None,
            },
            "messages": [m.public() for m in self.messages if m.id > since],
            "lastId": self._next_id - 1,
            "activeAlertId": self.active_alert,
            "away": self.away,
            "breakUntil": self.break_until or None,
            "hushUntil": self.hush_until if now < self.hush_until else None,
            "snoozeUntil": self.snooze_until if now < self.snooze_until else None,
            "buddyOnline": self.buddy_online(now),
            "extensionOnline": self.extension_online(now),
            "axTrusted": bool(d and d.ax_trusted),
            "llmOnline": self.brain.online,
            "stallLevel": self.stall_level,
            "today": {"focusSeconds": today.get("focusSeconds", 0),
                      "distractionSeconds": today.get("distractionSeconds", 0),
                      "alertCount": today.get("alertCount", 0)},
        }

    async def run(self) -> None:
        while True:
            try:
                self.tick()
            except Exception:  # pragma: no cover - the loop must survive anything
                logger.exception("coach tick failed")
            await asyncio.sleep(self.settings.coach_tick_seconds)


_coach: Optional[Coach] = None


def get_coach() -> Coach:
    global _coach
    if _coach is None:
        from config import get_settings

        s = get_settings()
        _coach = Coach(s, ProfileStore(s.data_dir), ActivityStore(s.data_dir), Brain(s))
    return _coach


def reset_coach(coach: Optional[Coach] = None) -> None:
    global _coach
    if _coach is not None and _coach is not coach:
        _coach.store.close()
    _coach = coach
