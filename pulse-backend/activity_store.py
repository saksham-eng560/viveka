"""Local SQLite log of what was on screen (segments) and what Sheru said (alerts)."""
from __future__ import annotations

import datetime as dt
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from models import Event

SCORES = {"focus": 85, "neutral": 55, "distraction": 15}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start REAL NOT NULL,
  end REAL NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  app TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL,
  category TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  goal TEXT
);
CREATE INDEX IF NOT EXISTS segments_start ON segments(start);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  kind TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_ts ON alerts(ts);
"""


@dataclass
class Segment:
    start: float
    end: float
    key: str
    label: str
    app: str
    domain: str
    url: str
    title: str
    verdict: str
    category: str
    reason: str
    goal: Optional[str]


class ActivityStore:
    def __init__(self, data_dir: str | Path) -> None:
        self.path = Path(data_dir) / "lighthouse.db"
        self._conn: Optional[sqlite3.Connection] = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(self.path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(_SCHEMA)
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    # ------------------------------------------------------------------ writes
    def open_segment(self, seg: Segment) -> int:
        cur = self.conn.execute(
            "INSERT INTO segments(start,end,key,label,app,domain,url,title,verdict,category,reason,goal)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (seg.start, seg.end, seg.key, seg.label[:120], seg.app[:120], seg.domain[:200], seg.url[:500],
             seg.title[:300], seg.verdict, seg.category[:40], seg.reason[:200], seg.goal),
        )
        self.conn.commit()
        return int(cur.lastrowid or 0)

    def extend_segment(self, seg_id: int, end: float, verdict: Optional[str] = None, category: Optional[str] = None,
                       reason: Optional[str] = None) -> None:
        if verdict is None:
            self.conn.execute("UPDATE segments SET end=? WHERE id=?", (end, seg_id))
        else:
            self.conn.execute("UPDATE segments SET end=?, verdict=?, category=?, reason=? WHERE id=?",
                              (end, verdict, (category or "")[:40], (reason or "")[:200], seg_id))
        self.conn.commit()

    def log_alert(self, ts: float, kind: str, level: int, label: str, text: str) -> None:
        self.conn.execute("INSERT INTO alerts(ts,kind,level,label,text) VALUES (?,?,?,?,?)",
                          (ts, kind, level, label[:120], text[:500]))
        self.conn.commit()

    def clear(self) -> None:
        self.conn.execute("DELETE FROM segments")
        self.conn.execute("DELETE FROM alerts")
        self.conn.commit()

    # ------------------------------------------------------------------- reads
    def segments_between(self, start: float, end: float) -> list[sqlite3.Row]:
        return list(self.conn.execute(
            "SELECT * FROM segments WHERE end > ? AND start < ? AND end > start ORDER BY start", (start, end)))

    def alerts_between(self, start: float, end: float) -> list[sqlite3.Row]:
        return list(self.conn.execute("SELECT * FROM alerts WHERE ts >= ? AND ts < ? ORDER BY ts", (start, end)))

    def events_between(self, start: dt.datetime, end: dt.datetime) -> list[Event]:
        """Segments in the shape the summary/timeline/standup code already understands."""
        lo, hi = start.timestamp(), end.timestamp()
        out: list[Event] = []
        for r in self.segments_between(lo, hi):
            s, e = max(r["start"], lo), min(r["end"], hi)
            if e - s < 1:
                continue
            url = r["url"] or (f"https://{r['domain']}/" if r["domain"] else f"app://{r['label']}")
            out.append(Event(
                timestamp=dt.datetime.fromtimestamp(s, dt.timezone.utc),
                duration=e - s,
                url=url,
                hostname=r["domain"] or r["label"],
                title=r["title"] or r["label"],
                score=SCORES.get(r["verdict"], 55),
                category=r["category"] or "Other",
                reasoning=r["reason"],
                goal=r["goal"],
            ))
        return out

    def today_stats(self, start: float, end: float) -> dict[str, Any]:
        totals = {"focus": 0.0, "neutral": 0.0, "distraction": 0.0}
        by_label: dict[tuple[str, str], float] = {}
        for r in self.segments_between(start, end):
            dur = min(r["end"], end) - max(r["start"], start)
            if dur <= 0:
                continue
            totals[r["verdict"]] = totals.get(r["verdict"], 0.0) + dur
            k = (r["verdict"], r["label"])
            by_label[k] = by_label.get(k, 0.0) + dur

        def top(kind: str) -> list[dict[str, Any]]:
            items = sorted(((lbl, secs) for (v, lbl), secs in by_label.items() if v == kind), key=lambda x: -x[1])
            return [{"label": lbl, "seconds": int(secs)} for lbl, secs in items[:5]]

        alerts = self.alerts_between(start, end)
        return {
            "focusSeconds": int(totals["focus"]),
            "neutralSeconds": int(totals["neutral"]),
            "distractionSeconds": int(totals["distraction"]),
            "topFocus": top("focus"),
            "topDistractions": top("distraction"),
            "alerts": [
                {"ts": dt.datetime.fromtimestamp(a["ts"], dt.timezone.utc).isoformat(), "kind": a["kind"],
                 "level": a["level"], "label": a["label"], "text": a["text"]}
                for a in alerts[-30:]
            ],
            "alertCount": sum(1 for a in alerts if a["kind"] in ("distraction", "stall")),
        }
