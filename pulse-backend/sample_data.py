"""Deterministic demo data: a day spent building a React dashboard, with detours."""
from __future__ import annotations

import datetime as dt
import random
import zlib
from typing import Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from models import Event

GOAL = "Building a React dashboard for the hackathon"

# (url, title, minutes, score, category, reasoning); None url == away from keyboard.
_Seg = tuple[Optional[str], str, int, int, str, str]

_SCRIPT: list[_Seg] = [
    ("https://github.com/viveka-team/pulse-dashboard/pulls", "Pull requests · viveka-team/pulse-dashboard", 12, 94, "Coding", "Reviewing dashboard pull requests."),
    ("https://vscode.dev/github/viveka-team/pulse-dashboard/src/App.tsx", "App.tsx - pulse-dashboard - Visual Studio Code for the Web", 35, 98, "Coding", "Writing the React dashboard app shell."),
    ("https://react.dev/reference/react/useEffect", "useEffect – React", 8, 85, "Documentation", "React docs directly support the dashboard goal."),
    ("https://vscode.dev/github/viveka-team/pulse-dashboard/src/features/MetricCards.tsx", "MetricCards.tsx - pulse-dashboard - Visual Studio Code for the Web", 28, 97, "Coding", "Building dashboard metric cards."),
    ("https://app.slack.com/client/T0HACK/C0TEAM", "#hackathon-team - Viveka - Slack", 6, 55, "Communication", "Team chat, partly related to the project."),
    ("https://recharts.org/en-US/api/AreaChart", "AreaChart | Recharts", 14, 88, "Documentation", "Charting docs for the timeline view."),
    ("https://vscode.dev/github/viveka-team/pulse-dashboard/src/features/TimelineChart.tsx", "TimelineChart.tsx - pulse-dashboard - Visual Studio Code for the Web", 40, 98, "Coding", "Implementing the focus timeline chart."),
    ("https://www.reddit.com/r/reactjs/", "r/reactjs - The React subreddit", 7, 14, "Social Media", "Forum scrolling, not tied to the current task."),
    ("https://stackoverflow.com/questions/68930120/recharts-responsive-container-height", "Recharts ResponsiveContainer height 0 - Stack Overflow", 9, 82, "Research", "Fixing a chart sizing bug."),
    ("https://vscode.dev/github/viveka-team/pulse-dashboard/src/lib/timeline.ts", "timeline.ts - pulse-dashboard - Visual Studio Code for the Web", 25, 96, "Coding", "Writing timeline binning logic."),
    ("https://www.youtube.com/watch?v=jfKfPfyJRdk", "lofi hip hop radio - beats to relax/study to - YouTube", 12, 8, "Entertainment", "Background video, unrelated to the goal."),
    ("https://github.com/viveka-team/pulse-dashboard/issues/14", "Chart tooltip overflows on mobile · Issue #14", 10, 90, "Coding", "Triaging a dashboard bug."),
    (None, "lunch", 45, 0, "", ""),
    ("https://tailwindcss.com/docs/dark-mode", "Dark Mode - Tailwind CSS", 11, 84, "Documentation", "Styling docs for the dashboard theme."),
    ("https://vscode.dev/github/viveka-team/pulse-dashboard/src/features/CategoryBreakdown.tsx", "CategoryBreakdown.tsx - pulse-dashboard - Visual Studio Code for the Web", 45, 97, "Coding", "Building the category breakdown chart."),
    ("https://x.com/home", "Home / X", 5, 12, "Social Media", "Social feed, not related to the dashboard."),
    ("http://localhost:3000/", "Pulse Dashboard", 15, 95, "Coding", "Previewing the running dashboard."),
    ("https://app.slack.com/client/T0HACK/C0TEAM", "#hackathon-team - Viveka - Slack", 8, 58, "Communication", "Team chat, partly related to the project."),
    ("https://www.reddit.com/r/programming/", "r/programming", 10, 18, "Social Media", "Browsing general programming news."),
    ("https://www.youtube.com/watch?v=ZsHMHukIlJY", "Build a React Dashboard with Recharts - Tutorial - YouTube", 14, 65, "Research", "Tutorial loosely relevant to a React dashboard."),
    ("https://vscode.dev/github/viveka-team/pulse-dashboard/src/features/StandupGenerator.tsx", "StandupGenerator.tsx - pulse-dashboard - Visual Studio Code for the Web", 38, 98, "Coding", "Implementing the standup generator UI."),
    ("https://www.youtube.com/watch?v=hY7m5jjJ9mM", "Cats being cats - funniest compilation - YouTube", 9, 5, "Entertainment", "Entertainment video unrelated to the goal."),
    ("https://github.com/viveka-team/pulse-dashboard/pull/21", "Add standup generator by viveka-team · Pull Request #21", 14, 91, "Coding", "Opening a pull request for the dashboard."),
    ("http://localhost:3000/", "Pulse Dashboard", 12, 94, "Coding", "Testing the dashboard in the browser."),
    ("https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText", "Clipboard: writeText() method - Web APIs | MDN", 8, 83, "Documentation", "Docs for the copy-standup button."),
    ("https://vscode.dev/github/viveka-team/pulse-dashboard/src/App.tsx", "App.tsx - pulse-dashboard - Visual Studio Code for the Web", 30, 96, "Coding", "Polishing the dashboard layout."),
    ("https://www.reddit.com/r/webdev/", "r/webdev", 6, 20, "Social Media", "Forum browsing, off task."),
    ("https://docs.google.com/presentation/d/1viveka-demo/edit", "Hackathon Demo Deck - Google Slides", 18, 72, "Planning", "Preparing the demo; supports the project."),
    ("https://app.slack.com/client/T0HACK/C0TEAM", "#hackathon-team - Viveka - Slack", 6, 52, "Communication", "Team chat, partly related to the project."),
]


def _hostname(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def sample_events(date: dt.date, tz: Optional[str] = None) -> list[Event]:
    """Pure, deterministic ~8h workday for `date` in `tz` (default: server local zone)."""
    if tz:
        zone: dt.tzinfo = ZoneInfo(tz)
    else:
        zone = dt.datetime.now().astimezone().tzinfo or dt.timezone.utc
    rng = random.Random(zlib.crc32(date.isoformat().encode()))
    cursor = dt.datetime.combine(date, dt.time(9, 0), tzinfo=zone)
    events: list[Event] = []
    for url, title, minutes, score, category, reasoning in _SCRIPT:
        seconds = max(60, int(minutes * 60 * rng.uniform(0.85, 1.15)))
        if url is None:
            cursor += dt.timedelta(seconds=seconds)
            continue
        jitter = rng.randint(-2, 2)
        final = max(5, min(98, score + jitter)) if score not in (5, 98) else score
        events.append(
            Event(
                timestamp=cursor,
                duration=float(seconds),
                url=url,
                hostname=_hostname(url),
                title=title,
                score=final,
                category=category,
                reasoning=reasoning,
                goal=GOAL,
            )
        )
        cursor += dt.timedelta(seconds=seconds)
    return events
