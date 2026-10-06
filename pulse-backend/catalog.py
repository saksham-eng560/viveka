"""What apps and sites usually mean, and the chips offered during onboarding.

Rules here are instant and deterministic. Anything ambiguous (YouTube, an unknown
site or app) is marked `ambiguous=True` so the coach can ask the local LLM, using
the user's goals, while this heuristic answer is shown in the meantime.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Literal, Optional
from urllib.parse import urlparse

VerdictKind = Literal["focus", "neutral", "distraction"]


@dataclass(frozen=True)
class Chip:
    id: str
    label: str
    apps: tuple[str, ...] = ()  # bundle ids (exact) or lowercase app names
    domains: tuple[str, ...] = ()


@dataclass(frozen=True)
class Rule:
    verdict: VerdictKind
    category: str
    writing: bool = False  # typing is the work here (editors, docs, coding practice)
    ambiguous: bool = False
    reason: str = ""


@dataclass
class Activity:
    """What is on screen right now, from the desktop buddy and/or the browser extension."""

    app: str = ""
    bundle_id: str = ""
    title: str = ""
    url: str = ""
    domain: str = ""

    @property
    def is_web(self) -> bool:
        return bool(self.domain)

    @property
    def key(self) -> str:
        return f"web:{self.domain}" if self.domain else f"app:{(self.bundle_id or self.app).lower()}"

    @property
    def label(self) -> str:
        if self.domain:
            return pretty_domain(self.domain)
        return self.app or self.bundle_id or "this app"


@dataclass
class Verdict:
    kind: VerdictKind
    category: str
    reason: str
    writing: bool = False
    source: Literal["profile", "rule", "llm", "heuristic", "override"] = "heuristic"
    ambiguous: bool = False
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def score(self) -> int:
        return {"focus": 85, "neutral": 55, "distraction": 15}[self.kind]


# ----------------------------------------------------------------------------- chips
WORK_TOOLS: tuple[Chip, ...] = (
    Chip("vscode", "VS Code / Cursor", ("com.microsoft.vscode", "com.visualstudio.code.oss", "com.todesktop.230313mzl4w4u92",
                                         "com.exafunction.windsurf", "code", "cursor", "windsurf", "dev.zed.zed", "zed"),
         ("vscode.dev", "github.dev")),
    Chip("xcode", "Xcode", ("com.apple.dt.xcode", "xcode")),
    Chip("jetbrains", "JetBrains IDEs", ("com.jetbrains.intellij", "com.jetbrains.pycharm", "com.jetbrains.webstorm",
                                         "com.jetbrains.clion", "com.jetbrains.goland", "com.google.android.studio",
                                         "intellij idea", "pycharm", "webstorm", "android studio")),
    Chip("terminal", "Terminal", ("com.apple.terminal", "com.googlecode.iterm2", "dev.warp.warp-stable",
                                  "com.mitchellh.ghostty", "terminal", "iterm2", "warp", "ghostty")),
    Chip("google-docs", "Google Docs / Sheets", (), ("docs.google.com", "sheets.google.com", "slides.google.com")),
    Chip("notion", "Notion", ("notion.id", "notion"), ("notion.so", "notion.site")),
    Chip("word", "Word / Pages", ("com.microsoft.word", "com.apple.iwork.pages", "microsoft word", "pages")),
    Chip("excel", "Excel / Numbers", ("com.microsoft.excel", "com.apple.iwork.numbers", "microsoft excel", "numbers")),
    Chip("slides", "Keynote / PowerPoint", ("com.apple.iwork.keynote", "com.microsoft.powerpoint", "keynote",
                                            "microsoft powerpoint")),
    Chip("notes", "Notes / Obsidian", ("com.apple.notes", "md.obsidian", "notes", "obsidian"), ()),
    Chip("figma", "Figma", ("com.figma.desktop", "figma"), ("figma.com",)),
    Chip("github", "GitHub", (), ("github.com", "gitlab.com", "bitbucket.org")),
    Chip("dsa", "LeetCode / DSA sites", (), ("leetcode.com", "takeuforward.org", "geeksforgeeks.org", "codeforces.com",
                                              "hackerrank.com", "codechef.com", "neetcode.io", "interviewbit.com")),
    Chip("overleaf", "Overleaf / LaTeX", ("texshop", "texstudio"), ("overleaf.com",)),
    Chip("courses", "Online courses", (), ("coursera.org", "udemy.com", "edx.org", "khanacademy.org", "nptel.ac.in",
                                           "unacademy.com", "physicswallah.live", "pw.live", "brilliant.org")),
    Chip("ai", "ChatGPT / Claude", ("com.openai.chat", "com.anthropic.claudefordesktop", "chatgpt", "claude"),
         ("chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com", "perplexity.ai")),
)

DISTRACTIONS: tuple[Chip, ...] = (
    Chip("youtube", "YouTube", (), ("youtube.com", "youtu.be")),
    Chip("instagram", "Instagram", (), ("instagram.com",)),
    Chip("reddit", "Reddit", (), ("reddit.com",)),
    Chip("x", "X / Twitter", (), ("x.com", "twitter.com")),
    Chip("facebook", "Facebook", (), ("facebook.com", "fb.com")),
    Chip("netflix", "Netflix / Prime / Hotstar", ("com.netflix.netflix",),
         ("netflix.com", "primevideo.com", "hotstar.com", "jiohotstar.com", "sonyliv.com", "zee5.com", "disneyplus.com")),
    Chip("whatsapp", "WhatsApp / Telegram", ("net.whatsapp.whatsapp", "ru.keepcoder.telegram", "whatsapp", "telegram"),
         ("web.whatsapp.com", "web.telegram.org")),
    Chip("discord", "Discord", ("com.hnc.discord", "discord"), ("discord.com",)),
    Chip("games", "Games", ("com.valvesoftware.steam", "com.epicgames.launcherapp", "steam", "epic games launcher"),
         ("chess.com", "lichess.org", "poki.com", "crazygames.com", "miniclip.com")),
    Chip("news", "News", (), ("news.google.com", "inshorts.com", "cnn.com", "bbc.com", "ndtv.com", "timesofindia.indiatimes.com",
                              "news.ycombinator.com")),
    Chip("shopping", "Shopping", (), ("amazon.in", "amazon.com", "flipkart.com", "myntra.com", "ajio.com", "meesho.com")),
    Chip("tiktok", "TikTok / Shorts", (), ("tiktok.com",)),
    Chip("twitch", "Twitch", (), ("twitch.tv",)),
)

GOAL_IDEAS: tuple[str, ...] = (
    "Crack DSA for placements", "Finish my thesis chapter", "Learn React properly", "Ship my side project",
    "Prepare for exams", "Write every day", "Build my portfolio", "Study for GATE / UPSC",
)

# --------------------------------------------------------------------------- rules
_APP_RULES: tuple[tuple[tuple[str, ...], Rule], ...] = (
    (WORK_TOOLS[0].apps + WORK_TOOLS[1].apps + WORK_TOOLS[2].apps + ("com.sublimetext.4", "sublime text", "nova",
                                                                       "com.panic.nova", "bbedit", "textedit",
                                                                       "com.apple.textedit", "neovide"),
     Rule("focus", "Coding", writing=True, reason="Your editor: this is where things get built.")),
    (WORK_TOOLS[3].apps, Rule("focus", "Coding", writing=True, reason="The terminal: hands-on work.")),
    (WORK_TOOLS[6].apps + WORK_TOOLS[9].apps + ("com.microsoft.onenote.mac", "onenote", "bear", "net.shinyfrog.bear",
                                                "craft", "ulysses", "scrivener", "typora", "abnerworks.typora",
                                                "mweb", "logseq", "com.electron.logseq", "overleaf") + WORK_TOOLS[13].apps,
     Rule("focus", "Writing", writing=True, reason="A writing app: words in progress.")),
    (WORK_TOOLS[7].apps + WORK_TOOLS[8].apps + WORK_TOOLS[10].apps + ("preview", "com.apple.preview", "adobe acrobat",
                                                                      "com.adobe.acrobat.pro", "skim", "zotero",
                                                                      "org.zotero.zotero", "anki", "net.ankiweb.dtop"),
     Rule("focus", "Work", reason="A work tool for your goals.")),
    (("com.tinyspeck.slackmacgap", "slack", "com.apple.mail", "mail", "com.microsoft.outlook", "microsoft outlook",
      "com.microsoft.teams2", "microsoft teams", "us.zoom.xos", "zoom.us", "com.apple.ichat", "messages",
      "com.apple.facetime", "facetime") + DISTRACTIONS[7].apps,
     Rule("neutral", "Chat", reason="Messages and calls: fine in small doses.")),
    (("com.spotify.client", "spotify", "com.apple.music", "music", "com.apple.podcasts", "podcasts"),
     Rule("neutral", "Music", reason="Background music can help you focus.")),
    (DISTRACTIONS[8].apps + ("com.apple.tv", "tv", "vlc", "org.videolan.vlc", "iina", "com.colliderli.iina")
     + DISTRACTIONS[5].apps,
     Rule("distraction", "Fun", reason="Games and shows: great for breaks, not for work time.")),
    (("com.apple.finder", "finder", "com.apple.systempreferences", "system settings", "system preferences",
      "com.apple.activitymonitor", "activity monitor", "com.apple.dock", "dock", "loginwindow", "com.apple.loginwindow",
      "com.apple.screensaver.engine", "screensaver", "com.apple.spotlight", "spotlight", "com.apple.controlcenter",
      "control center", "com.apple.notificationcenterui", "lighthouse buddy", "dev.lighthouse.buddy", "sheru", "dev.sheru.app",
      "com.apple.systemuiserver", "1password", "com.1password.1password", "raycast", "com.raycast.macos",
      "alfred", "com.runningwithcrayons.alfred", "app store", "com.apple.appstore", "calendar", "com.apple.ical",
      "reminders", "com.apple.reminders", "clock", "calculator", "com.apple.calculator"),
     Rule("neutral", "System", reason="Housekeeping on your Mac.")),
)

BROWSER_BUNDLES = {
    "com.google.chrome", "com.google.chrome.canary", "com.google.chrome.for.testing", "com.brave.browser",
    "com.brave.browser.beta", "com.microsoft.edgemac", "org.chromium.chromium", "company.thebrowser.browser",
    "com.apple.safari", "org.mozilla.firefox", "com.vivaldi.vivaldi", "com.operasoftware.opera", "app.zen-browser.zen",
}
BROWSER_NAMES = {"google chrome", "chrome", "brave browser", "microsoft edge", "chromium", "arc", "safari", "firefox",
                 "vivaldi", "opera", "zen", "google chrome for testing"}

_DOMAIN_RULES: tuple[tuple[tuple[str, ...], Rule], ...] = (
    (WORK_TOOLS[0].domains + WORK_TOOLS[11].domains + WORK_TOOLS[12].domains + ("stackoverflow.com", "stackexchange.com",
                                                                               "replit.com", "codesandbox.io",
                                                                               "stackblitz.com", "localhost",
                                                                               "127.0.0.1", "vercel.com",
                                                                               "netlify.com"),
     Rule("focus", "Coding", writing=True, reason="A place for writing code.")),
    (WORK_TOOLS[4].domains + WORK_TOOLS[5].domains + WORK_TOOLS[13].domains + ("quip.com", "coda.io", "hackmd.io"),
     Rule("focus", "Writing", writing=True, reason="Your document: words in progress.")),
    (WORK_TOOLS[10].domains + WORK_TOOLS[14].domains + ("developer.mozilla.org", "react.dev", "docs.python.org",
                                                        "devdocs.io", "readthedocs.io", "w3schools.com", "npmjs.com",
                                                        "typescriptlang.org", "wikipedia.org", "scholar.google.com",
                                                        "arxiv.org", "drive.google.com", "linear.app", "trello.com",
                                                        "asana.com", "atlassian.net", "canva.com", "miro.com"),
     Rule("focus", "Learning", reason="Reference and learning material.")),
    (WORK_TOOLS[15].domains, Rule("neutral", "AI", ambiguous=True, reason="An AI assistant: depends what you ask it.")),
    (("mail.google.com", "outlook.live.com", "outlook.office.com", "slack.com", "app.slack.com", "teams.microsoft.com",
      "meet.google.com", "zoom.us", "calendar.google.com") + DISTRACTIONS[6].domains + DISTRACTIONS[7].domains,
     Rule("neutral", "Chat", reason="Messages and calls: fine in small doses.")),
    (("google.com", "bing.com", "duckduckgo.com", "search.brave.com"),
     Rule("neutral", "Search", reason="Searching can be part of the work.")),
    (("open.spotify.com", "music.youtube.com", "music.apple.com", "soundcloud.com", "jiosaavn.com", "gaana.com"),
     Rule("neutral", "Music", reason="Background music can help you focus.")),
    (DISTRACTIONS[0].domains, Rule("neutral", "Video", ambiguous=True, reason="Videos can teach or distract.")),
    (DISTRACTIONS[1].domains + DISTRACTIONS[4].domains + DISTRACTIONS[11].domains + ("snapchat.com", "pinterest.com",
                                                                                     "9gag.com", "threads.net"),
     Rule("distraction", "Social", reason="A social feed: designed to keep you scrolling.")),
    (DISTRACTIONS[2].domains + DISTRACTIONS[3].domains,
     Rule("distraction", "Social", ambiguous=True, reason="Forums and feeds pull you sideways.")),
    (DISTRACTIONS[5].domains + DISTRACTIONS[12].domains + ("hulu.com", "crunchyroll.com", "mxplayer.in"),
     Rule("distraction", "Video", reason="Streaming: perfect for breaks, not for work.")),
    (DISTRACTIONS[8].domains, Rule("distraction", "Games", reason="Games are fun, but not on the clock.")),
    (DISTRACTIONS[9].domains, Rule("distraction", "News", ambiguous=True, reason="The news can wait a little.")),
    (DISTRACTIONS[10].domains, Rule("distraction", "Shopping", reason="Window shopping steals minutes.")),
)

_TITLE_HINTS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(rf"(?:^|[\s\-|•·(]){re.escape(name)}(?:$|[\s\-|•·)])", re.I), domain)
    for name, domain in (
        ("YouTube", "youtube.com"), ("Instagram", "instagram.com"), ("Reddit", "reddit.com"), ("Netflix", "netflix.com"),
        ("Facebook", "facebook.com"), ("WhatsApp", "web.whatsapp.com"), ("Twitch", "twitch.tv"), ("X", "x.com"),
        ("LeetCode", "leetcode.com"), ("takeUforward", "takeuforward.org"), ("GitHub", "github.com"),
        ("Google Docs", "docs.google.com"), ("Notion", "notion.so"), ("Stack Overflow", "stackoverflow.com"),
        ("ChatGPT", "chatgpt.com"), ("Claude", "claude.ai"), ("Amazon", "amazon.com"), ("Flipkart", "flipkart.com"),
        ("Prime Video", "primevideo.com"), ("Hotstar", "hotstar.com"), ("Overleaf", "overleaf.com"),
        ("GeeksforGeeks", "geeksforgeeks.org"), ("Codeforces", "codeforces.com"),
    )
)

_STOPWORDS = set(
    "about after again also and are build building built but can for from get getting have into just learn learning "
    "make making more need needs not the their them then these this those today use using want was what when will "
    "with work working write writing your my our finish complete start prepare preparing study studying properly "
    "every daily side".split()
)


# ------------------------------------------------------------------------- helpers
def domain_of(url: str) -> str:
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    if parsed.scheme not in ("http", "https"):
        return ""
    host = (parsed.hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


_PRETTY = {
    "youtube.com": "YouTube", "youtu.be": "YouTube", "instagram.com": "Instagram", "x.com": "X", "twitter.com": "X",
    "reddit.com": "Reddit", "facebook.com": "Facebook", "netflix.com": "Netflix", "primevideo.com": "Prime Video",
    "hotstar.com": "Hotstar", "jiohotstar.com": "JioHotstar", "web.whatsapp.com": "WhatsApp", "docs.google.com": "Google Docs",
    "sheets.google.com": "Google Sheets", "github.com": "GitHub", "leetcode.com": "LeetCode", "takeuforward.org": "takeUforward",
    "geeksforgeeks.org": "GeeksforGeeks", "stackoverflow.com": "Stack Overflow", "chatgpt.com": "ChatGPT", "claude.ai": "Claude",
    "notion.so": "Notion", "tiktok.com": "TikTok", "twitch.tv": "Twitch", "amazon.in": "Amazon", "amazon.com": "Amazon",
    "flipkart.com": "Flipkart", "linkedin.com": "LinkedIn", "mail.google.com": "Gmail", "news.ycombinator.com": "Hacker News",
    "overleaf.com": "Overleaf", "coursera.org": "Coursera", "udemy.com": "Udemy", "codeforces.com": "Codeforces",
    "music.youtube.com": "YouTube Music", "open.spotify.com": "Spotify", "web.telegram.org": "Telegram",
    "discord.com": "Discord", "pinterest.com": "Pinterest", "myntra.com": "Myntra", "chess.com": "Chess.com",
}


def pretty_domain(domain: str) -> str:
    if domain in _PRETTY:
        return _PRETTY[domain]
    for d, label in _PRETTY.items():
        if domain.endswith("." + d):
            return label
    parts = domain.split(".")
    core = parts[-2] if len(parts) >= 2 else domain
    return core[:1].upper() + core[1:]


def _domain_matches(domain: str, pattern: str) -> bool:
    return domain == pattern or domain.endswith("." + pattern)


def is_browser(activity: Activity) -> bool:
    return activity.bundle_id.lower() in BROWSER_BUNDLES or activity.app.lower() in BROWSER_NAMES


def _app_tokens(activity: Activity) -> set[str]:
    return {activity.bundle_id.lower(), activity.app.lower()} - {""}


def chip_matches(chip: Chip, activity: Activity) -> bool:
    if activity.domain:
        return any(_domain_matches(activity.domain, d) for d in chip.domains)
    tokens = _app_tokens(activity)
    return any(a in tokens for a in chip.apps)


def custom_matches(entry: str, activity: Activity) -> bool:
    """A free-text chip like 'leetcode.com' or 'Spotify' typed by the user."""
    e = entry.strip().lower()
    if not e:
        return False
    if activity.domain:
        if "." in e:
            e_dom = domain_of(e if e.startswith("http") else f"https://{e}")
            return bool(e_dom) and _domain_matches(activity.domain, e_dom)
        return e in activity.domain.split(".")
    return e in _app_tokens(activity)


def resolve_chips(ids: Iterable[str], catalog: tuple[Chip, ...]) -> tuple[list[Chip], list[str]]:
    by_id = {c.id: c for c in catalog}
    chips, custom = [], []
    for raw in ids:
        if raw in by_id:
            chips.append(by_id[raw])
        elif raw.strip():
            custom.append(raw.strip())
    return chips, custom


def goal_keywords(goals: Iterable[str]) -> list[str]:
    seen: list[str] = []
    for g in goals:
        for w in re.findall(r"[a-z0-9+#]{3,}", g.lower()):
            if w not in _STOPWORDS and w not in seen:
                seen.append(w)
    # common synonyms so "DSA" also matches "algorithm" titles etc.
    extra = {"dsa": ["algorithm", "leetcode", "graph", "array", "dynamic", "tree"], "react": ["jsx", "hooks"],
             "thesis": ["paper", "chapter", "research"], "exam": ["exam", "syllabus", "mock"],
             "exams": ["exam", "syllabus", "mock"], "gate": ["gate"], "upsc": ["upsc", "polity", "ncert"]}
    for w in list(seen):
        for s in extra.get(w, []):
            if s not in seen:
                seen.append(s)
    return seen


def title_hits(title: str, goals: Iterable[str]) -> list[str]:
    hay = title.lower()
    return [k for k in goal_keywords(goals) if len(k) >= 3 and re.search(rf"\b{re.escape(k)}", hay)]


def domain_from_browser_title(title: str) -> str:
    """Guess the site from a browser window title such as 'Shorts - YouTube - Google Chrome'."""
    for pattern, domain in _TITLE_HINTS:
        if pattern.search(title):
            return domain
    return ""


def rule_for(activity: Activity) -> Optional[Rule]:
    if activity.domain:
        for domains, rule in _DOMAIN_RULES:
            if any(_domain_matches(activity.domain, d) for d in domains):
                return rule
        return None
    tokens = _app_tokens(activity)
    for apps, rule in _APP_RULES:
        if any(a in tokens for a in apps):
            return rule
    return None


def is_system(activity: Activity) -> bool:
    return not activity.domain and bool(_app_tokens(activity) & set(_APP_RULES[-1][0]))


def heuristic_verdict(activity: Activity, goals: list[str], work_tools: list[str], distractions: list[str],
                      overrides: Optional[dict[str, VerdictKind]] = None) -> Verdict:
    """Instant verdict: user overrides > profile chips > built-in rules > keyword match."""
    overrides = overrides or {}
    if activity.key in overrides:
        kind = overrides[activity.key]
        return Verdict(kind, "Work" if kind == "focus" else "Marked", "You told me how to treat this.",
                       writing=bool(rule_for(activity) and rule_for(activity).writing), source="override")

    rule = rule_for(activity)
    hits = title_hits(activity.title, goals)
    is_shorts = "/shorts/" in activity.url or "#shorts" in activity.title.lower()

    work_chips, work_custom = resolve_chips(work_tools, WORK_TOOLS)
    dis_chips, dis_custom = resolve_chips(distractions, DISTRACTIONS)
    in_work = any(chip_matches(c, activity) for c in work_chips) or any(custom_matches(e, activity) for e in work_custom)
    in_dis = any(chip_matches(c, activity) for c in dis_chips) or any(custom_matches(e, activity) for e in dis_custom)

    if in_work and not in_dis:
        return Verdict("focus", rule.category if rule and rule.verdict == "focus" else "Work",
                       "One of your work tools.", writing=bool(rule and rule.writing) or not activity.domain,
                       source="profile")
    if in_dis:
        if hits and not is_shorts and (rule is None or rule.ambiguous):
            return Verdict("focus", "Learning", f"Looks related to your goal ({', '.join(hits[:2])}).",
                           source="heuristic", ambiguous=True)
        return Verdict("distraction", rule.category if rule else "Distraction",
                       "You listed this as a usual distraction.", source="profile",
                       ambiguous=bool(rule and rule.ambiguous))
    if rule:
        kind: VerdictKind = rule.verdict
        reason = rule.reason
        if rule.ambiguous and hits and not is_shorts:
            kind, reason = "focus", f"Looks related to your goal ({', '.join(hits[:2])})."
        elif rule.category == "Video" and is_shorts:
            kind, reason = "distraction", "Shorts are made to keep you swiping."
        return Verdict(kind, rule.category, reason, writing=rule.writing, source="rule", ambiguous=rule.ambiguous)
    if hits:
        return Verdict("focus", "Learning", f"Looks related to your goal ({', '.join(hits[:2])}).",
                       source="heuristic", ambiguous=True)
    return Verdict("neutral", "Browsing" if activity.domain else "App", "Not sure yet how this relates to your goals.",
                   source="heuristic", ambiguous=True)


def catalog_payload() -> dict[str, object]:
    return {
        "workTools": [{"id": c.id, "label": c.label} for c in WORK_TOOLS],
        "distractions": [{"id": c.id, "label": c.label} for c in DISTRACTIONS],
        "goalIdeas": list(GOAL_IDEAS),
    }
