"""
Builds docs/business/Sheru_Business_Plan.pdf

Every number shown in the PDF (charts, tables, prose) is derived from the
single MODEL section below, so changing an assumption re-flows the whole
document consistently.

Run:  uv run --with reportlab --with matplotlib python docs/business/build_business_plan.py
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.patches import Circle, FancyArrowPatch, FancyBboxPatch, Rectangle

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether, NextPageTemplate,
    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = Path(__file__).resolve().parent
CHARTS = HERE / "charts"
CHARTS.mkdir(exist_ok=True)
PDF_PATH = HERE / "Sheru_Business_Plan.pdf"
TODAY = dt.date(2026, 10, 6)

# ═════════════════════════════════════════════════════════════════════════════
# DESIGN TOKENS  (categorical slots 1-4 of the validated reference palette,
# used in fixed order; chrome/ink from the same reference)
# ═════════════════════════════════════════════════════════════════════════════
S1, S2, S3, S4 = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
INK, INK2, MUTED = "#0b0b0b", "#52514e", "#898781"
GRID, BASE, SURF = "#e1e0d9", "#c3c2b7", "#fcfcfb"
NAVY, NAVY2 = "#0f1f35", "#1c3354"
BEACON = "#f5b524"
ZEBRA = "#f4f3ef"
BLUE_RAMP = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281"]

FONT_DIR = Path("/System/Library/Fonts/Supplemental")
for f in ["Arial.ttf", "Arial Bold.ttf", "Arial Italic.ttf"]:
    if (FONT_DIR / f).exists():
        fm.fontManager.addfont(str(FONT_DIR / f))

plt.rcParams.update({
    "font.family": "Arial",
    "font.size": 10,
    "axes.edgecolor": BASE,
    "axes.labelcolor": INK2,
    "axes.titlesize": 12,
    "axes.titleweight": "bold",
    "axes.titlecolor": INK,
    "axes.titlelocation": "left",
    "axes.titlepad": 12,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "xtick.labelcolor": INK2,
    "ytick.labelcolor": INK2,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "axes.grid.axis": "y",
    "grid.color": GRID,
    "grid.linewidth": 0.6,
    "axes.axisbelow": True,
    "legend.frameon": False,
    "legend.fontsize": 9,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "savefig.dpi": 220,
})

# ═════════════════════════════════════════════════════════════════════════════
# MODEL — all assumptions live here
# ═════════════════════════════════════════════════════════════════════════════
YEARS = ["2027", "2028", "2029", "2030", "2031"]

USERS_END = [25_000, 110_000, 350_000, 800_000, 1_600_000]   # registered (free + paid)
PRO_RATE = [0.040, 0.050, 0.060, 0.065, 0.070]               # share of users on Pro
MIND_RATE = [0.004, 0.006, 0.008, 0.009, 0.010]              # share of users on Mind
TEAMS_SEATS_END = [0, 2_000, 12_000, 40_000, 90_000]
ENT_SEATS_END = [0, 0, 3_000, 15_000, 45_000]

# Blended monthly ARPU (regional pricing + annual discounts; India-heavy early mix)
ARPU_PRO = [4.5, 5.0, 5.5, 6.0, 6.2]
ARPU_MIND = [30, 32, 38, 44, 48]
ARPU_TEAMS = [10, 10, 10, 10, 10]
ARPU_ENT = [18, 18, 18, 18, 18]

CLINICIAN_SHARE_MIND = 0.50       # psychologist payout as % of Mind revenue
CLINICIAN_SHARE_ENT = 0.30        # pooled sessions as % of Enterprise revenue
INFRA_FREE = 0.10                 # $/free user/month (auth, licensing, updates)
INFRA_PAID = 0.60                 # $/paid seat/month (E2EE sync, reports, storage)
VIDEO_PER_SESSION = 0.50          # $/50-min video session
ENT_SESSION_UTIL = 0.08           # enterprise seats booking a session per month
PAYMENTS_PCT = 0.03
SUPPORT_PCT = 0.04

HEADCOUNT = [6, 14, 30, 55, 85]
COST_PER_HEAD = [30_000, 36_000, 42_000, 48_000, 54_000]
MARKETING = [40_000, 260_000, 900_000, 2_300_000, 4_800_000]
GA_FIXED = 60_000
GA_PCT = 0.06

SESSIONS_PER_CLINICIAN = 80       # Mind members one full-time psychologist can carry

UNIT = {  # tier: (monthly ARPU, gross margin, monthly churn, CAC)
    "Pro": (5.5, 0.88, 0.050, 25),
    "Mind": (40, 0.44, 0.060, 80),
    "Teams (seat)": (10, 0.90, 0.015, 120),
    "Enterprise (seat)": (18, 0.62, 0.010, 250),
}


def _avg(end):
    prev = [0] + end[:-1]
    return [(a + b) / 2 for a, b in zip(prev, end)]


def build_model():
    m = {}
    m["pro_end"] = [round(u * r) for u, r in zip(USERS_END, PRO_RATE)]
    m["mind_end"] = [round(u * r) for u, r in zip(USERS_END, MIND_RATE)]
    m["teams_end"] = TEAMS_SEATS_END
    m["ent_end"] = ENT_SEATS_END
    for k in ["pro", "mind", "teams", "ent"]:
        m[f"{k}_avg"] = _avg(m[f"{k}_end"])
    m["users_avg"] = _avg(USERS_END)

    m["rev_pro"] = [a * p * 12 for a, p in zip(m["pro_avg"], ARPU_PRO)]
    m["rev_mind"] = [a * p * 12 for a, p in zip(m["mind_avg"], ARPU_MIND)]
    m["rev_teams"] = [a * p * 12 for a, p in zip(m["teams_avg"], ARPU_TEAMS)]
    m["rev_ent"] = [a * p * 12 for a, p in zip(m["ent_avg"], ARPU_ENT)]
    m["rev"] = [sum(x) for x in zip(m["rev_pro"], m["rev_mind"], m["rev_teams"], m["rev_ent"])]

    m["arr_exit"] = [
        (p * ap + mi * am + t * at + e * ae) * 12
        for p, mi, t, e, ap, am, at, ae in zip(
            m["pro_end"], m["mind_end"], m["teams_end"], m["ent_end"],
            ARPU_PRO, ARPU_MIND, ARPU_TEAMS, ARPU_ENT)
    ]

    paid_avg = [sum(x) for x in zip(m["pro_avg"], m["mind_avg"], m["teams_avg"], m["ent_avg"])]
    free_avg = [u - p - mi for u, p, mi in zip(m["users_avg"], m["pro_avg"], m["mind_avg"])]
    sessions = [mi * 12 + e * ENT_SESSION_UTIL * 12 for mi, e in zip(m["mind_avg"], m["ent_avg"])]

    m["cogs_clin"] = [CLINICIAN_SHARE_MIND * a + CLINICIAN_SHARE_ENT * b for a, b in zip(m["rev_mind"], m["rev_ent"])]
    m["cogs_infra"] = [f * INFRA_FREE * 12 + p * INFRA_PAID * 12 + s * VIDEO_PER_SESSION
                       for f, p, s in zip(free_avg, paid_avg, sessions)]
    m["cogs_other"] = [(PAYMENTS_PCT + SUPPORT_PCT) * r for r in m["rev"]]
    m["cogs"] = [sum(x) for x in zip(m["cogs_clin"], m["cogs_infra"], m["cogs_other"])]
    m["gp"] = [r - c for r, c in zip(m["rev"], m["cogs"])]
    m["gm"] = [g / r if r else 0 for g, r in zip(m["gp"], m["rev"])]

    m["opex_people"] = [h * c for h, c in zip(HEADCOUNT, COST_PER_HEAD)]
    m["opex_mkt"] = MARKETING
    m["opex_ga"] = [GA_FIXED + GA_PCT * r for r in m["rev"]]
    m["opex"] = [sum(x) for x in zip(m["opex_people"], m["opex_mkt"], m["opex_ga"])]
    m["total_cost"] = [c + o for c, o in zip(m["cogs"], m["opex"])]
    m["ebitda"] = [g - o for g, o in zip(m["gp"], m["opex"])]
    m["cum_ebitda"] = [sum(m["ebitda"][: i + 1]) for i in range(5)]

    m["clin_mind"] = [mi / SESSIONS_PER_CLINICIAN for mi in m["mind_end"]]
    m["clin_ent"] = [e * ENT_SESSION_UTIL * 3 / SESSIONS_PER_CLINICIAN for e in m["ent_end"]]
    m["paid_seats_end"] = [sum(x) for x in zip(m["pro_end"], m["mind_end"], m["teams_end"], m["ent_end"])]

    m["unit"] = {}
    for tier, (arpu, gm, churn, cac) in UNIT.items():
        ltv = arpu * gm / churn
        m["unit"][tier] = dict(arpu=arpu, gm=gm, churn=churn, cac=cac, ltv=ltv,
                               ratio=ltv / cac, payback=cac / (arpu * gm))
    be = next((YEARS[i] for i, e in enumerate(m["ebitda"]) if e > 0), "beyond 2031")
    m["breakeven"] = be
    m["peak_burn"] = -min(m["cum_ebitda"])
    return m


M = build_model()


def money(x, digits=1):
    s = "-" if x < 0 else ""
    x = abs(x)
    if x >= 1e9:
        return f"{s}${x / 1e9:.{digits}f}B"
    if x >= 1e6:
        return f"{s}${x / 1e6:.{digits}f}M"
    if x >= 1e4:
        return f"{s}${x / 1e3:.0f}K"
    if x >= 1e3:
        return f"{s}${x / 1e3:.{digits}f}K"
    return f"{s}${x:.0f}"


def num(x):
    if x >= 1e6:
        return f"{x / 1e6:.1f}M"
    if x >= 1e3:
        return f"{x / 1e3:.0f}K" if x >= 1e4 else f"{x:,.0f}"
    return f"{x:,.0f}"


# ═════════════════════════════════════════════════════════════════════════════
# CHARTS
# ═════════════════════════════════════════════════════════════════════════════
def _save(fig, name):
    p = CHARTS / f"{name}.png"
    fig.savefig(p, bbox_inches="tight", pad_inches=0.15)
    plt.close(fig)
    return p


def _money_axis(ax, axis="y"):
    fmt = matplotlib.ticker.FuncFormatter(lambda v, _: money(v, 0) if v else "$0")
    (ax.yaxis if axis == "y" else ax.xaxis).set_major_formatter(fmt)


def _clean(ax):
    ax.tick_params(length=0)
    ax.spines["left"].set_visible(False)


def chart_market():
    fig, ax = plt.subplots(figsize=(8, 3.9))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5)
    ax.set_aspect("equal")
    ax.axis("off")
    layers = [
        (2.35, "#cde2fb", "TAM", "~1B knowledge workers", "$96B / yr at Pro list price"),
        (1.55, "#86b6ef", "SAM", "~60M focus-challenged desktop workers", "IN · US · UK · EU, Chrome/Brave"),
        (0.72, S1, "SOM", f"{num(USERS_END[-1])} users by 2031", f"{money(M['arr_exit'][-1])} exit ARR"),
    ]
    cx, cy = 2.5, 2.5
    for r, c, *_ in layers:
        ax.add_patch(Circle((cx, cy - (2.35 - r)), r, facecolor=c, edgecolor="white", lw=2))
    ys = [4.25, 2.55, 0.95]
    for (r, c, tag, l1, l2), y in zip(layers, ys):
        cy_l = cy - (2.35 - r) + r - 0.35 if tag != "SOM" else cy - (2.35 - r)
        ax.text(cx, cy_l, tag, ha="center", va="center", fontsize=11, fontweight="bold",
                color="white" if tag == "SOM" else NAVY)
        ax.plot([cx + (0.5 if tag != "SOM" else 0.72), 5.55], [cy_l, y], color=BASE, lw=0.8)
        ax.text(5.65, y + 0.12, l1, fontsize=10.5, fontweight="bold", color=INK, va="bottom")
        ax.text(5.65, y - 0.05, l2, fontsize=9.5, color=INK2, va="top")
    ax.text(0, -0.15, "Circles not to scale. Bottom-up sizing; assumptions in Appendix A.", fontsize=8, color=MUTED)
    return _save(fig, "01_market_sizing")


def chart_roi():
    mins = [10, 25, 45]
    days = 220
    rates = [("India professional (~$12/hr)", 12, S1), ("Global professional (~$40/hr)", 40, S2)]
    fig, ax = plt.subplots(figsize=(8, 3.8))
    w = 0.34
    for i, (lab, rate, c) in enumerate(rates):
        vals = [m / 60 * days * rate for m in mins]
        xs = [j + (i - 0.5) * (w + 0.02) for j in range(3)]
        ax.bar(xs, vals, w, color=c, label=lab)
        for x, v in zip(xs, vals):
            ax.text(x, v + 80, money(v, 1), ha="center", fontsize=8.5, color=INK2)
    pro_year = 8 * 12
    ax.axhline(pro_year, color=INK, lw=1.2, ls=(0, (4, 3)), label=f"Pro subscription (${pro_year}/yr)")
    ax.set_xticks(range(3), [f"{m} min/day recovered" for m in mins])
    _money_axis(ax)
    _clean(ax)
    ax.set_title("Annual value of recovered focus time per user")
    ax.legend(loc="upper left")
    return _save(fig, "02_user_roi")


def chart_seats():
    fig, ax = plt.subplots(figsize=(8, 3.8))
    series = [("Pro", M["pro_end"], S1), ("Mind (psychologist)", M["mind_end"], S2),
              ("Teams seats", M["teams_end"], S3), ("Enterprise Wellbeing seats", M["ent_end"], S4)]
    bottom = [0] * 5
    for lab, vals, c in series:
        ax.bar(YEARS, vals, 0.55, bottom=bottom, color=c, label=lab, edgecolor="white", linewidth=1.2)
        bottom = [b + v for b, v in zip(bottom, vals)]
    for i, t in enumerate(bottom):
        ax.text(i, t * 1.02 + 1500, num(t), ha="center", fontsize=9, fontweight="bold", color=INK)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: num(v)))
    _clean(ax)
    ax.set_title("Paying seats at year end, by tier")
    ax.legend(loc="upper left", ncols=2)
    return _save(fig, "03_paying_seats")


def chart_revenue():
    fig, ax = plt.subplots(figsize=(8, 3.8))
    series = [("Pro", M["rev_pro"], S1), ("Mind", M["rev_mind"], S2),
              ("Teams", M["rev_teams"], S3), ("Enterprise Wellbeing", M["rev_ent"], S4)]
    bottom = [0] * 5
    for lab, vals, c in series:
        ax.bar(YEARS, vals, 0.55, bottom=bottom, color=c, label=lab, edgecolor="white", linewidth=1.2)
        bottom = [b + v for b, v in zip(bottom, vals)]
    for i, t in enumerate(bottom):
        ax.text(i, t + max(bottom) * 0.015, money(t), ha="center", fontsize=9, fontweight="bold", color=INK)
    _money_axis(ax)
    _clean(ax)
    ax.set_title("Recognised revenue by stream (base case)")
    ax.legend(loc="upper left", ncols=2)
    return _save(fig, "04_revenue_by_stream")


def chart_mix():
    fig, ax = plt.subplots(figsize=(8, 1.9))
    vals = [M["rev_pro"][-1], M["rev_mind"][-1], M["rev_teams"][-1], M["rev_ent"][-1]]
    labs = ["Pro", "Mind", "Teams", "Enterprise Wellbeing"]
    tot = sum(vals)
    left = 0
    for v, l, c in zip(vals, labs, [S1, S2, S3, S4]):
        ax.barh([0], [v / tot], left=left, color=c, height=0.42, edgecolor="white", linewidth=2)
        ax.text(left + v / tot / 2, 0.36, l, ha="center", fontsize=9.5, color=INK, fontweight="bold")
        ax.text(left + v / tot / 2, -0.36, f"{v / tot:.0%} · {money(v)}", ha="center", fontsize=9, color=INK2)
        left += v / tot
    b2b = (vals[2] + vals[3]) / tot
    ax.set_xlim(0, 1)
    ax.set_ylim(-0.7, 0.7)
    ax.axis("off")
    ax.set_title(f"2031 revenue mix — {b2b:.0%} from B2B (Teams + Enterprise)", loc="left", pad=4)
    return _save(fig, "05_revenue_mix")


def chart_arr_scenarios():
    fig, ax = plt.subplots(figsize=(8, 3.6))
    base = M["arr_exit"]
    scen = [("Conservative (×0.5 adoption)", [b * 0.5 for b in base], S3),
            ("Base case", base, S1),
            ("Optimistic (×1.5 adoption)", [b * 1.5 for b in base], S2)]
    for lab, vals, c in scen:
        ax.plot(YEARS, vals, color=c, lw=2, marker="o", ms=6, mec="white", mew=1.5, label=lab)
        ax.text(4.08, vals[-1], money(vals[-1]), va="center", fontsize=9, color=INK2)
    _money_axis(ax)
    _clean(ax)
    ax.set_xlim(-0.2, 4.5)
    ax.set_title("Exit ARR by scenario")
    ax.legend(loc="upper left")
    return _save(fig, "06_arr_scenarios")


def chart_pnl():
    fig, ax = plt.subplots(figsize=(8, 3.9))
    x = range(5)
    w = 0.36
    ax.bar([i - w / 2 - 0.01 for i in x], M["rev"], w, color=S1, label="Revenue")
    ax.bar([i + w / 2 + 0.01 for i in x], M["total_cost"], w, color=BASE, label="Total cost (COGS + OpEx)")
    ax.plot(list(x), M["ebitda"], color=S2, lw=2, marker="o", ms=7, mec="white", mew=1.5, label="EBITDA")
    top = max(M["rev"])
    for i, e in enumerate(M["ebitda"]):
        ax.text(i, e + (top * 0.04 if e >= 0 else -top * 0.075), money(e),
                ha="center", fontsize=8.5, color=INK, fontweight="bold")
    ax.set_ylim(-top * 0.13, top * 1.08)
    ax.axhline(0, color=INK2, lw=0.8)
    ax.set_xticks(list(x), YEARS)
    _money_axis(ax)
    _clean(ax)
    ax.set_title(f"Revenue, cost and EBITDA — EBITDA-positive in {M['breakeven']}")
    ax.legend(loc="upper left")
    return _save(fig, "07_pnl")


def chart_unit_econ():
    fig, ax = plt.subplots(figsize=(8, 3.5))
    tiers = list(M["unit"].keys())
    y = range(len(tiers))
    h = 0.34
    ltv = [M["unit"][t]["ltv"] for t in tiers]
    cac = [M["unit"][t]["cac"] for t in tiers]
    ax.barh([i - h / 2 - 0.01 for i in y], ltv, h, color=S1, label="LTV (gross-margin based)")
    ax.barh([i + h / 2 + 0.01 for i in y], cac, h, color=S2, label="CAC")
    for i, t in enumerate(tiers):
        u = M["unit"][t]
        ax.text(u["ltv"] + 15, i - h / 2, f"${u['ltv']:,.0f}   LTV/CAC {u['ratio']:.1f}×",
                va="center", fontsize=8.5, color=INK)
        ax.text(u["cac"] + 15, i + h / 2, f"${u['cac']}", va="center", fontsize=8.5, color=INK2)
    ax.set_yticks(list(y), tiers)
    ax.invert_yaxis()
    ax.grid(axis="x")
    ax.grid(axis="y", visible=False)
    ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:,.0f}"))
    ax.tick_params(length=0)
    ax.spines["bottom"].set_visible(False)
    ax.set_xlim(0, max(ltv) * 1.35)
    ax.set_title("Unit economics by tier")
    ax.legend(loc="upper right")
    return _save(fig, "08_unit_economics")


def chart_infra():
    fig, ax = plt.subplots(figsize=(8, 3.6))
    mau = [1e3, 1e4, 1e5, 1e6]
    local = [0.40, 0.24, 0.15, 0.10]
    cloud = [1.60, 1.42, 1.27, 1.17]
    ax.plot(mau, cloud, color=S2, lw=2, marker="o", ms=7, mec="white", mew=1.5, label="Cloud-AI competitor model")
    ax.plot(mau, local, color=S1, lw=2, marker="o", ms=7, mec="white", mew=1.5, label="Sheru local-first")
    ax.fill_between(mau, local, cloud, color=S1, alpha=0.07, lw=0)
    ax.set_xscale("log")
    ax.set_xticks(mau, ["1K", "10K", "100K", "1M"])
    ax.minorticks_off()
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"${v:.2f}"))
    ax.text(mau[-1] * 0.9, local[-1] + 0.1, "$0.10", ha="right", fontsize=9, color=INK)
    ax.text(mau[-1] * 0.9, cloud[-1] + 0.08, "$1.17", ha="right", fontsize=9, color=INK)
    ax.text(3e4, 0.75, "≈ $1/user/month saved\n(no inference bill)", fontsize=9, color=INK2, ha="center")
    _clean(ax)
    ax.set_ylim(0, 1.9)
    ax.set_xlabel("Monthly active users")
    ax.set_title("Infrastructure cost per active user per month")
    ax.legend(loc="upper right")
    return _save(fig, "09_infra_cost")


def chart_clinicians():
    fig, ax = plt.subplots(figsize=(8, 3.5))
    a, b = M["clin_mind"], M["clin_ent"]
    ax.bar(YEARS, a, 0.55, color=S2, label="Mind members", edgecolor="white", linewidth=1.2)
    ax.bar(YEARS, b, 0.55, bottom=a, color=S4, label="Enterprise pooled sessions", edgecolor="white", linewidth=1.2)
    for i, (x, y) in enumerate(zip(a, b)):
        ax.text(i, x + y + 4, f"{x + y:,.0f}", ha="center", fontsize=9, fontweight="bold", color=INK)
    _clean(ax)
    ax.set_title(f"Full-time-equivalent psychologists required (1 FTE ≈ {SESSIONS_PER_CLINICIAN} members)")
    ax.legend(loc="upper left")
    return _save(fig, "10_clinicians")


RISKS = [
    (1, "Clinical safety incident", 2, 5),
    (2, "Breach of synced data", 2, 5),
    (3, "Psychologist supply & quality", 3, 4),
    (4, "Low free → paid conversion", 3, 4),
    (5, "Employer misuse as surveillance", 2, 4),
    (6, "Health-data regulation shifts", 3, 3),
    (7, "Big-tech bundled focus modes", 3, 3),
    (8, "Chrome Web Store / MV3 policy", 2, 3),
    (9, "Local LLM speed on low-end PCs", 4, 2),
]


def chart_risk():
    fig, ax = plt.subplots(figsize=(8, 4.2))
    ramp = ["#eef4fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5"]
    for li in range(1, 6):
        for im in range(1, 6):
            s = li * im
            c = ramp[0] if s <= 4 else ramp[1] if s <= 8 else ramp[2] if s <= 12 else ramp[3] if s <= 16 else ramp[4]
            ax.add_patch(Rectangle((li - 0.5, im - 0.5), 1, 1, facecolor=c, edgecolor="white", lw=2))
    offsets = {}
    for n, _, li, im in RISKS:
        k = (li, im)
        o = offsets.get(k, 0)
        offsets[k] = o + 1
        x = li + (o - 0.5) * 0.36 if (li, im) in [(2, 5), (3, 4), (3, 3)] else li
        ax.add_patch(Circle((x, im), 0.16, facecolor=NAVY, edgecolor="white", lw=1.5, zorder=3))
        ax.text(x, im, str(n), ha="center", va="center", color="white", fontsize=9, fontweight="bold", zorder=4)
    ax.set_xlim(0.5, 5.5)
    ax.set_ylim(0.5, 5.5)
    ax.set_aspect("equal")
    ax.set_xticks(range(1, 6), ["Rare", "Unlikely", "Possible", "Likely", "Frequent"])
    ax.set_yticks(range(1, 6), ["Minor", "Low", "Moderate", "Major", "Severe"])
    ax.grid(False)
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_xlabel("Likelihood")
    ax.set_ylabel("Impact", labelpad=10)
    ax.set_title("Risk heat map (numbers refer to Table 12.2)")
    for i, (n, lab, *_) in enumerate(RISKS):
        fig.text(0.70, 0.80 - i * 0.068, f"{n}  {lab}", fontsize=8.6, color=INK2)
    fig.subplots_adjust(right=0.66)
    return _save(fig, "11_risk_matrix")


ROADMAP = [
    ("Harden MVP + Chrome Web Store launch", 0, 1, S1),
    ("Accounts, licensing, Pro billing", 0, 2, S1),
    ("Opt-in E2EE sync + hosted dashboard", 1, 3, S1),
    ("Mind pilot — India, 10 psychologists", 2, 4, S2),
    ("Mind GA + clinician portal", 3, 5, S2),
    ("Teams tier + admin console", 3, 6, S3),
    ("Desktop app (macOS / Windows)", 4, 7, S1),
    ("Mobile companion (iOS / Android)", 5, 8, S1),
    ("Enterprise Wellbeing, SSO, SOC 2", 5, 9, S3),
    ("US / EU expansion (HIPAA, GDPR)", 6, 9, S2),
]
QUARTERS = ["Q4'26", "Q1'27", "Q2'27", "Q3'27", "Q4'27", "Q1'28", "Q2'28", "Q3'28", "Q4'28"]


def chart_roadmap():
    fig, ax = plt.subplots(figsize=(8, 5.0))
    for i, (lab, s, e, c) in enumerate(ROADMAP):
        ax.add_patch(FancyBboxPatch((s + 0.05, i - 0.3), e - s - 0.1, 0.6,
                                    boxstyle="round,pad=0,rounding_size=0.12", facecolor=c, edgecolor="none"))
    ax.set_yticks(range(len(ROADMAP)), [r[0] for r in ROADMAP], fontsize=11)
    ax.set_xticks([q + 0.5 for q in range(9)], QUARTERS, fontsize=9.5)
    ax.set_xlim(0, 9)
    ax.set_ylim(len(ROADMAP) - 0.4, -0.6)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=GRID)
    ax.set_xticks(range(10), minor=True)
    ax.grid(axis="x", which="minor", color=GRID)
    ax.grid(axis="x", which="major", visible=False)
    ax.xaxis.tick_top()
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color=S1, label="Product & platform"), Patch(color=S2, label="Sheru Mind"),
                       Patch(color=S3, label="B2B")], loc="lower left", bbox_to_anchor=(0, -0.13), ncols=3)
    return _save(fig, "12_roadmap")


def chart_funnel():
    fig, ax = plt.subplots(figsize=(8, 3.4))
    stages = [("Store visitors", 100), ("Install extension", 32), ("Activated (first focus session)", 19),
              ("Weekly active after 30 days", 9.5), ("Paid — Pro", 1.6), ("Paid — Mind", 0.25)]
    ramp = [BLUE_RAMP[1], BLUE_RAMP[2], BLUE_RAMP[3], BLUE_RAMP[5], BLUE_RAMP[7], BLUE_RAMP[8]]
    for i, ((lab, v), c) in enumerate(zip(stages, ramp)):
        w = max(v, 1.2)
        ax.barh(i, w, left=(100 - w) / 2, color=c, height=0.72)
        ax.text(-2, i, lab, ha="right", va="center", fontsize=9.5, color=INK)
        ax.text(102, i, f"{v:g}%", ha="left", va="center", fontsize=9.5, color=INK, fontweight="bold")
    ax.set_xlim(-48, 112)
    ax.invert_yaxis()
    ax.axis("off")
    ax.set_title("Target acquisition funnel (per 100 store visitors)", loc="left")
    return _save(fig, "13_funnel")


def _box(ax, x, y, w, h, title, sub="", fc="white", ec=S1, tc=INK, fs=10.5):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.08",
                                facecolor=fc, edgecolor=ec, lw=1.3))
    if sub:
        ax.text(x + w / 2, y + h * 0.63, title, ha="center", va="center", fontsize=fs, fontweight="bold", color=tc)
        ax.text(x + w / 2, y + h * 0.28, sub, ha="center", va="center", fontsize=fs - 2.2, color=INK2 if tc == INK else tc)
    else:
        ax.text(x + w / 2, y + h / 2, title, ha="center", va="center", fontsize=fs, fontweight="bold", color=tc)


def _arrow(ax, a, b, label="", color=INK2, rad=0.0, ls="-", lpos=0.5, loff=(0, 0.12)):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle="-|>", mutation_scale=11, color=color, lw=1.2,
                                 connectionstyle=f"arc3,rad={rad}", linestyle=ls, shrinkA=2, shrinkB=2))
    if label:
        mx, my = a[0] + (b[0] - a[0]) * lpos + loff[0], a[1] + (b[1] - a[1]) * lpos + loff[1]
        ax.text(mx, my, label, ha="center", va="center", fontsize=8.2, color=INK2,
                bbox=dict(facecolor="white", edgecolor="none", pad=1))


def chart_architecture():
    fig, ax = plt.subplots(figsize=(8.5, 5.27))
    fig.subplots_adjust(0, 0, 1, 1)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6.2)
    ax.axis("off")
    zones = [(0.05, 3.2, "YOUR DEVICE — local-first (today)", "#eef4fd"),
             (3.35, 3.7, "LIGHTHOUSE CLOUD — opt-in (new)", "#fdf3ec"),
             (7.15, 2.8, "PEOPLE & PARTNERS", "#eefaf4")]
    for x, w, t, c in zones:
        ax.add_patch(FancyBboxPatch((x, 0.05), w, 6.1, boxstyle="round,pad=0,rounding_size=0.12",
                                    facecolor=c, edgecolor="none"))
        ax.text(x + 0.15, 5.85, t, fontsize=9, fontweight="bold", color=NAVY, va="center")
    rows = [4.5, 3.3, 2.1, 0.9]          # bottoms of the four aligned rows
    H = 0.9
    # device column
    _box(ax, 0.25, rows[0], 2.8, H, "Chrome MV3 extension", "tracking · nudges · side panel")
    _box(ax, 0.25, rows[1], 1.3, H, "Ollama", "local LLM", fs=9.8)
    _box(ax, 1.75, rows[1], 1.3, H, "ActivityWatch", "SQLite events", fs=9.8)
    _box(ax, 0.25, rows[2], 2.8, H, "Pulse engine", "metrics · stand-ups · Focus Report")
    _box(ax, 0.25, rows[3], 2.8, H, "Local consent vault", "keys · what-to-share rules", ec=NAVY)
    _arrow(ax, (0.9, rows[0]), (0.9, rows[1] + H), "classify", loff=(0, 0))
    _arrow(ax, (2.4, rows[0]), (2.4, rows[1] + H), "heartbeats", loff=(0, 0))
    _arrow(ax, (2.4, rows[1]), (2.4, rows[2] + H))
    _arrow(ax, (1.65, rows[2]), (1.65, rows[3] + H), "aggregates only", loff=(0, 0))
    # cloud: vertical gateway + aligned services
    gx, gw = 3.5, 0.75
    ax.add_patch(FancyBboxPatch((gx, rows[3]), gw, rows[0] + H - rows[3], boxstyle="round,pad=0,rounding_size=0.08",
                                facecolor="white", edgecolor=S2, lw=1.3))
    ax.text(gx + gw / 2, (rows[3] + rows[0] + H) / 2, "API gateway + Auth  ·  passkeys · OAuth · licence tokens",
            rotation=90, ha="center", va="center", fontsize=9, fontweight="bold", color=INK)
    sx, sw = 4.5, 2.35
    svc = [("Sync service", "E2EE ciphertext only"), ("Billing service", "plans · dunning · tax"),
           ("Mind service", "match · schedule · reports"), ("Team insights", "aggregates, k-anon ≥ 5")]
    for (t, sub), y in zip(svc, rows):
        _box(ax, sx, y, sw, H, t, sub, ec=S2)
        _arrow(ax, (gx + gw, y + H / 2), (sx, y + H / 2))
    ax.text(3.5 + 3.35 / 2, 0.45, "Postgres (tenants) · encrypted object store · queue workers",
            ha="center", va="center", fontsize=8.2, color=INK2)
    # people
    px, pw = 7.3, 2.5
    ppl = [("Your other devices", "web · desktop · mobile"), ("Payments", "Stripe · Razorpay (UPI)"),
           ("Psychologist portal", "Focus Report · video · chat"), ("Team admin console", "seats · SSO · trends")]
    for (t, sub), y in zip(ppl, rows):
        _box(ax, px, y, pw, H, t, sub, ec=S3)
        _arrow(ax, (sx + sw, y + H / 2), (px, y + H / 2))
    # device → cloud
    _arrow(ax, (3.05, rows[0] + H / 2), (gx, rows[0] + H / 2), "licence", loff=(0, 0.16))
    _arrow(ax, (3.05, rows[3] + H / 2), (gx, rows[3] + H / 2), color=S2)
    ax.text((3.05 + gx) / 2, rows[3] + H / 2 + 0.3, "E2EE,\nconsent", ha="center", fontsize=7.8, color="#b13d1e")
    return _save(fig, "14_architecture")


def chart_mind_cycle():
    fig, ax = plt.subplots(figsize=(8.5, 3.91))
    fig.subplots_adjust(0, 0, 1, 1)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4.6)
    ax.axis("off")
    _box(ax, 0.1, 1.7, 1.9, 1.2, "Intake & match", "once · screener,\ngoals, language, fit", ec=NAVY, fs=10.5)
    pts = {"A": (3.0, 3.2), "B": (7.2, 3.2), "C": (7.2, 0.35), "D": (3.0, 0.35)}
    W, H = 2.6, 1.05
    _box(ax, *pts["A"], W, H, "Day 0 · Focus Report", "built locally · member approves", ec=S1)
    _box(ax, *pts["B"], W, H, "Week 1 · 50-min session", "video with matched psychologist", ec=S2)
    _box(ax, *pts["C"], W, H, "Weeks 1–4 · Plan runs", "goals → extension nudges & tone", ec=S3)
    _box(ax, *pts["D"], W, H, "Weeks 2–4 · Check-ins", "async chat · 1-tap mood/energy", ec=S4)
    _arrow(ax, (2.0, 2.3), (3.0, 3.5))
    _arrow(ax, (5.6, 3.72), (7.2, 3.72))
    _arrow(ax, (8.5, 3.2), (8.5, 1.4))
    _arrow(ax, (7.2, 0.88), (5.6, 0.88))
    _arrow(ax, (4.3, 1.4), (4.3, 3.2))
    ax.text(6.4, 2.3, "Monthly\ncare loop", ha="center", va="center", fontsize=13, fontweight="bold", color=NAVY)
    ax.text(6.4, 1.75, "repeat every 30 days", ha="center", fontsize=8.5, color=INK2)
    ax.text(0.1, 0.55, "Safety rail at every step:\ncrisis language → helplines\n(Tele-MANAS 14416 · US 988)\n+ clinician escalation",
            fontsize=9, color="#b13d1e", va="center")
    return _save(fig, "15_mind_cycle")


# ═════════════════════════════════════════════════════════════════════════════
# PDF
# ═════════════════════════════════════════════════════════════════════════════
pdfmetrics.registerFont(TTFont("Arial", str(FONT_DIR / "Arial.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(FONT_DIR / "Arial Bold.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Italic", str(FONT_DIR / "Arial Italic.ttf")))
from reportlab.pdfbase.pdfmetrics import registerFontFamily

registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial-Italic", boldItalic="Arial-Bold")

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

ST = {
    "h1": ParagraphStyle("h1", fontName="Arial-Bold", fontSize=20, leading=25, textColor=colors.HexColor(NAVY),
                         spaceAfter=4),
    "kicker": ParagraphStyle("kicker", fontName="Arial-Bold", fontSize=8.5, leading=11,
                             textColor=colors.HexColor("#b07a00"), spaceAfter=2),
    "h2": ParagraphStyle("h2", fontName="Arial-Bold", fontSize=12.5, leading=16, textColor=colors.HexColor(NAVY),
                         spaceBefore=10, spaceAfter=4),
    "h3": ParagraphStyle("h3", fontName="Arial-Bold", fontSize=10.2, leading=13.5, textColor=colors.HexColor(INK),
                         spaceBefore=6, spaceAfter=2),
    "body": ParagraphStyle("body", fontName="Arial", fontSize=9.6, leading=14.2, textColor=colors.HexColor(INK),
                           spaceAfter=5),
    "lead": ParagraphStyle("lead", fontName="Arial", fontSize=11, leading=16.5, textColor=colors.HexColor(INK2),
                           spaceAfter=8),
    "bullet": ParagraphStyle("bullet", fontName="Arial", fontSize=9.6, leading=14, textColor=colors.HexColor(INK),
                             leftIndent=12, bulletIndent=2, spaceAfter=2.5),
    "cell": ParagraphStyle("cell", fontName="Arial", fontSize=8.4, leading=11.2, textColor=colors.HexColor(INK)),
    "cellb": ParagraphStyle("cellb", fontName="Arial-Bold", fontSize=8.4, leading=11.2,
                            textColor=colors.HexColor(INK)),
    "th": ParagraphStyle("th", fontName="Arial-Bold", fontSize=8.4, leading=11, textColor=colors.white),
    "cap": ParagraphStyle("cap", fontName="Arial-Italic", fontSize=8.2, leading=11, textColor=colors.HexColor(MUTED),
                          spaceBefore=2, spaceAfter=10),
    "tcap": ParagraphStyle("tcap", fontName="Arial-Bold", fontSize=8.2, leading=11, textColor=colors.HexColor(INK2),
                           spaceBefore=4, spaceAfter=4),
    "callout": ParagraphStyle("callout", fontName="Arial", fontSize=9.4, leading=13.8,
                              textColor=colors.HexColor(INK)),
    "kpi_v": ParagraphStyle("kpi_v", fontName="Arial-Bold", fontSize=17, leading=20, alignment=TA_CENTER,
                            textColor=colors.HexColor(NAVY)),
    "kpi_l": ParagraphStyle("kpi_l", fontName="Arial", fontSize=7.8, leading=10, alignment=TA_CENTER,
                            textColor=colors.HexColor(INK2)),
    "toc1": ParagraphStyle("toc1", fontName="Arial-Bold", fontSize=10.2, leading=15, spaceBefore=3, textColor=colors.HexColor(NAVY)),
    "toc2": ParagraphStyle("toc2", fontName="Arial", fontSize=9, leading=12.5, leftIndent=16,
                           textColor=colors.HexColor(INK2)),
}

FIG_N = [0]
TBL_N = {}


class Doc(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=22 * mm,
                         bottomMargin=20 * mm, title="Sheru — Business Impact & Scalability Plan",
                         author="Sheru", subject="Business plan, SaaS & Sheru Mind", **kw)
        frame = Frame(MARGIN, 20 * mm, CONTENT_W, PAGE_H - 42 * mm, id="f", leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate("cover", [frame], onPage=draw_cover),
                               PageTemplate("body", [frame], onPage=draw_chrome)])

    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and getattr(f, "_toc", None):
            lvl, text = f._toc
            key = f"s{id(f)}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=lvl, closed=False)
            self.notify("TOCEntry", (lvl, text, self.page, key))


def draw_cover(c, doc):
    c.saveState()
    c.setFillColor(colors.HexColor(NAVY))
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    # beacon beams
    bx, by = PAGE_W - 58 * mm, PAGE_H - 92 * mm
    for ang, a in [(-14, 0.10), (-4, 0.16), (6, 0.10)]:
        import math
        c.setFillColor(colors.Color(0.96, 0.71, 0.14, alpha=a))
        p = c.beginPath()
        p.moveTo(bx, by)
        r = 260 * mm
        for d in (ang - 9, ang + 9):
            p.lineTo(bx - r * math.cos(math.radians(d)), by + r * math.sin(math.radians(d)))
        p.close()
        c.drawPath(p, stroke=0, fill=1)
    # lighthouse
    c.setFillColor(colors.white)
    p = c.beginPath()
    p.moveTo(bx - 9 * mm, by - 70 * mm)
    p.lineTo(bx + 9 * mm, by - 70 * mm)
    p.lineTo(bx + 5 * mm, by - 6 * mm)
    p.lineTo(bx - 5 * mm, by - 6 * mm)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#d95926"))
    for k in range(3):
        y0 = by - 62 * mm + k * 20 * mm
        p = c.beginPath()
        w0 = 9 - (k * 20 + 0) / 64 * 4
        w1 = 9 - (k * 20 + 9) / 64 * 4
        p.moveTo(bx - w0 * mm, y0)
        p.lineTo(bx + w0 * mm, y0)
        p.lineTo(bx + w1 * mm, y0 + 9 * mm)
        p.lineTo(bx - w1 * mm, y0 + 9 * mm)
        p.close()
        c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(colors.HexColor(BEACON))
    c.circle(bx, by, 5.5 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor(NAVY2))
    c.rect(0, 0, PAGE_W, by - 70 * mm, stroke=0, fill=1)

    x = MARGIN
    c.setFillColor(colors.HexColor(BEACON))
    c.setFont("Arial-Bold", 10)
    c.drawString(x, PAGE_H - 40 * mm, "BUSINESS IMPACT  ·  SCALABILITY  ·  PRODUCT EXPANSION")
    c.setFillColor(colors.white)
    c.setFont("Arial-Bold", 44)
    c.drawString(x, PAGE_H - 62 * mm, "Sheru")
    c.setFont("Arial", 19)
    c.drawString(x, PAGE_H - 75 * mm, "From local focus coach to a")
    c.drawString(x, PAGE_H - 84 * mm, "privacy-first focus & mental-wellbeing")
    c.drawString(x, PAGE_H - 93 * mm, "SaaS platform")
    c.setFillColor(colors.HexColor("#c3cfe0"))
    c.setFont("Arial", 10.5)
    lines = ["Business plan covering monthly psychologist care (Sheru Mind),",
             "SaaS subscriptions, five-year financial model and scaling options."]
    for i, l in enumerate(lines):
        c.drawString(x, PAGE_H - 108 * mm - i * 14, l)
    # cover KPIs
    kp = [(money(M["arr_exit"][-1]), "2031 exit ARR (base)"),
          (num(M["paid_seats_end"][-1]), "paying seats 2031"),
          (M["breakeven"], "EBITDA break-even"),
          ("$0", "AI inference cost / user")]
    y = by - 70 * mm - 30 * mm
    colw = CONTENT_W / 4
    for i, (v, l) in enumerate(kp):
        cx = x + i * colw
        c.setFillColor(colors.HexColor(BEACON))
        c.setFont("Arial-Bold", 20)
        c.drawString(cx, y, v)
        c.setFillColor(colors.HexColor("#c3cfe0"))
        c.setFont("Arial", 8.5)
        c.drawString(cx, y - 13, l)
    c.setFillColor(colors.HexColor("#8a9ab3"))
    c.setFont("Arial", 8.5)
    c.drawString(x, 18 * mm, f"Version 1.0  ·  {TODAY.strftime('%d %B %Y')}  ·  Confidential — for founders, advisors and investors")
    c.restoreState()


def draw_chrome(c, doc):
    c.saveState()
    c.setStrokeColor(colors.HexColor(GRID))
    c.setLineWidth(0.6)
    c.line(MARGIN, PAGE_H - 14 * mm, PAGE_W - MARGIN, PAGE_H - 14 * mm)
    c.setFillColor(colors.HexColor(BEACON))
    c.circle(MARGIN + 1.6 * mm, PAGE_H - 11 * mm, 1.4 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor(NAVY))
    c.setFont("Arial-Bold", 8)
    c.drawString(MARGIN + 5 * mm, PAGE_H - 12 * mm, "LIGHTHOUSE")
    c.setFillColor(colors.HexColor(MUTED))
    c.setFont("Arial", 8)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 12 * mm, "Business Impact & Scalability Plan")
    c.line(MARGIN, 13 * mm, PAGE_W - MARGIN, 13 * mm)
    c.drawString(MARGIN, 9 * mm, "Confidential · illustrative projections, not guarantees")
    c.drawRightString(PAGE_W - MARGIN, 9 * mm, f"{doc.page}")
    c.restoreState()


# ── flowable helpers ─────────────────────────────────────────────────────────
def H1(num_, text, kicker=None):
    out = [CondPageBreak(70 * mm)]
    if kicker:
        out.append(Paragraph(kicker.upper(), ST["kicker"]))
    p = Paragraph(f"{num_}&nbsp;&nbsp;{text}", ST["h1"])
    p._toc = (0, f"{num_}  {text}")
    out.append(p)
    rule = Table([[""]], colWidths=[28 * mm], rowHeights=[2.2])
    rule.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(BEACON))]))
    rule.hAlign = "LEFT"
    out += [rule, Spacer(1, 9)]
    for f in out[1:]:
        f.keepWithNext = 1      # heading block always travels with what follows
    return out


def H2(text, toc=True):
    p = Paragraph(text, ST["h2"])
    p.keepWithNext = 1
    if toc:
        p._toc = (1, text)
    return p


def P(t, s="body"):
    return Paragraph(t, ST[s])


def B(items):
    return [Paragraph(i, ST["bullet"], bulletText="•") for i in items]


def fig(path, caption, width=CONTENT_W):
    FIG_N[0] += 1
    from reportlab.lib.utils import ImageReader
    iw, ih = ImageReader(str(path)).getSize()
    img = Image(str(path), width=width, height=width * ih / iw)
    img.keepWithNext = 1      # chained (not KeepTogether) so a preceding heading can join the group
    return [img, Paragraph(f"Figure {FIG_N[0]} — {caption}", ST["cap"])]


def table(rows, widths, header=True, bold_first_col=False, caption=None, zebra=True, align_right_from=None):
    data = []
    for r_i, row in enumerate(rows):
        out = []
        for c_i, cell in enumerate(row):
            if isinstance(cell, str):
                st = ST["th"] if (header and r_i == 0) else (
                    ST["cellb"] if (bold_first_col and c_i == 0 and not cell.startswith("&nbsp;")) else ST["cell"])
                if align_right_from is not None and c_i >= align_right_from and not (header and r_i == 0):
                    st = ParagraphStyle("r", parent=st, alignment=2)
                if align_right_from is not None and c_i >= align_right_from and header and r_i == 0:
                    st = ParagraphStyle("rh", parent=st, alignment=2)
                out.append(Paragraph(cell, st))
            else:
                out.append(cell)
        data.append(out)
    t = Table(data, colWidths=[w * CONTENT_W for w in widths], repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(GRID)),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(NAVY))]
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if (i % 2 == 0) == header:
                style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor(ZEBRA)))
    t.setStyle(TableStyle(style))
    # Caption sits above the table and is kept with it; short tables never split.
    cap = Paragraph(caption, ST["tcap"]) if caption else Spacer(1, 2)
    cap.keepWithNext = 1
    return [cap, t, Spacer(1, 10)]


def callout(title, text, color=BEACON):
    inner = [Paragraph(f"<b>{title}</b>", ParagraphStyle("ct", parent=ST["callout"], spaceAfter=2)),
             Paragraph(text, ST["callout"])]
    t = Table([["", inner]], colWidths=[3, CONTENT_W - 3])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor(color)),
        ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#fbf7ee" if color == BEACON else "#eef4fd")),
        ("LEFTPADDING", (1, 0), (1, 0), 10), ("RIGHTPADDING", (1, 0), (1, 0), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 0),
    ]))
    return [t, Spacer(1, 9)]


def kpi_row(items):
    cells = [[Paragraph(v, ST["kpi_v"]), Spacer(1, 2), Paragraph(l, ST["kpi_l"])] for v, l in items]
    t = Table([cells], colWidths=[CONTENT_W / len(items)] * len(items))
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f3f6fb")),
        ("LINEAFTER", (0, 0), (-2, -1), 1.5, colors.white),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return [t, Spacer(1, 10)]


# ═════════════════════════════════════════════════════════════════════════════
# CONTENT
# ═════════════════════════════════════════════════════════════════════════════
def story():
    charts = dict(
        market=chart_market(), roi=chart_roi(), seats=chart_seats(), revenue=chart_revenue(), mix=chart_mix(),
        arr=chart_arr_scenarios(), pnl=chart_pnl(), unit=chart_unit_econ(), infra=chart_infra(),
        clin=chart_clinicians(), risk=chart_risk(), roadmap=chart_roadmap(), funnel=chart_funnel(),
        arch=chart_architecture(), cycle=chart_mind_cycle(),
    )
    s = []
    rev5, arr5 = M["rev"][-1], M["arr_exit"][-1]
    gm5 = M["gm"][-1]
    u = M["unit"]

    # ── cover + TOC
    s += [NextPageTemplate("body"), PageBreak()]
    s += [Paragraph("Contents", ST["h1"]), Spacer(1, 8)]
    toc = TableOfContents()
    toc.levelStyles = [ST["toc1"], ST["toc2"]]
    toc.dotsMinLevel = 0
    toc.tableStyle = TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                 ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0.5),
                                 ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5)])
    s += [toc, PageBreak()]

    # ── 1 Executive summary
    s += H1("1", "Executive Summary", "Overview")
    s.append(P(
        "Sheru today is a working, privacy-first focus coach. A Chrome MV3 extension classifies every tab "
        "against the user's goal using a <b>local</b> LLM (Ollama), nudges them in real time, and the Pulse "
        "backend turns ActivityWatch data into focus analytics and AI stand-ups. This plan turns it into a "
        "business on three layers:", "lead"))
    s += B([
        "<b>SaaS subscriptions</b>. A free local tier stays free forever. Pro, Teams and Enterprise "
        "tiers add opt-in end-to-end-encrypted sync, a hosted dashboard, integrations and admin tools.",
        "<b>Sheru Mind</b>. A monthly subscription that pairs each member with a licensed psychologist. "
        "It includes one 50-minute video session a month, async check-ins and a consent-based <i>Focus Report</i>, "
        "so therapy is grounded in real attention data instead of memory.",
        "<b>Enterprise Wellbeing</b>. Employers buy Sheru + pooled psychologist access as a focus and "
        "burnout benefit. They see only anonymised aggregates, never individual browsing.",
    ])
    s.append(Spacer(1, 6))
    s += kpi_row([
        (money(rev5), "2031 revenue (base)"),
        (money(arr5), "2031 exit ARR"),
        (num(M["paid_seats_end"][-1]), "paying seats, 2031"),
        (f"{gm5:.0%}", "2031 gross margin"),
        (M["breakeven"], "EBITDA-positive"),
    ])
    s.append(H2("Why this works", toc=False))
    s += B([
        "<b>Structural cost advantage.</b> Classification runs on the user's own machine, so Sheru pays "
        "nothing for AI inference. Cloud-AI rivals pay roughly $1 per active user per month (Section 10). This keeps "
        f"software gross margin near 90% and lets the free tier scale to {num(USERS_END[-1])} users cheaply.",
        "<b>Trust is the product.</b> In mental health and workplace tools, privacy is the purchase criterion. "
        "Sheru can truthfully say raw browsing never leaves the device.",
        "<b>Data-informed care is differentiated.</b> Few therapy platforms see objective attention patterns. "
        "Sheru Mind gives psychologists a weekly picture of focus, context switching and late-night "
        "work, and turns their advice into in-browser nudges.",
        "<b>Land-and-expand.</b> Individual users bring the product into teams. Teams graduate to Enterprise "
        f"Wellbeing. By 2031, {(M['rev_teams'][-1] + M['rev_ent'][-1]) / rev5:.0%} of revenue is B2B.",
    ])
    s += callout("The ask, in one line",
                 f"About {money(M['peak_burn'])} of cumulative funding (plus a 30–50% buffer) takes the base case to EBITDA break-even in "
                 f"{M['breakeven']}. The first milestone is a 10-psychologist Mind pilot in India in Q2–Q3 2027, "
                 "used to validate retention and willingness to pay before scaling.")

    # ── 2 Current state
    s += H1("2", "Where Sheru Stands Today", "Starting point")
    s.append(P("The repository already contains a functional, tested MVP across three apps. That matters "
               "commercially: most of the hard, differentiating work (local classification, nudges, analytics) "
               "is done. The work ahead is mostly the commercial shell around it."))
    s += table([
        ["Component", "What exists in the repo", "Gap to commercial SaaS"],
        ["Chrome extension (MV3)", "Tab tracking, Ollama classification, 0–100 focus score, DOM nudges, voice "
         "nudges, side panel, AI tab grouping, Context Reset, offscreen keep-alive", "Licence check, account "
         "login, tier feature-flags, Web Store listing, telemetry opt-in"],
        ["Pulse backend (FastAPI)", "Summary, timeline and stand-up APIs over ActivityWatch; graceful "
         "fallbacks (sample data, template stand-ups)", "Multi-tenant cloud variant, auth, sync ingest, "
         "Focus Report generator, billing webhooks"],
        ["Pulse dashboard (React)", "Metric cards, timeline, category breakdown, typewriter stand-up "
         "generator, tests", "Hosted version, team views, psychologist view, subscription settings"],
        ["Ops", "setup/start/stop/test scripts, docker-compose, three test suites",
         "CI/CD, cloud infra-as-code, monitoring, SOC 2 controls"],
    ], [0.2, 0.45, 0.35], bold_first_col=True, caption="Table 2.1 — Product inventory vs. commercial gaps")

    # ── 3 Market
    s += H1("3", "Problem & Market Opportunity", "Market")
    s.append(H2("The problem, sharpened"))
    s += B([
        "<b>Distraction is now the default state of knowledge work.</b> Browsers hold most work and most "
        "distraction, and static blocklists cannot tell a React tutorial from a cat video on the same site.",
        "<b>Attention problems and mental health are linked but treated separately.</b> The WHO estimates "
        "depression and anxiety cost the global economy about <b>US$1 trillion a year</b> in lost productivity. "
        "Adult ADHD symptoms affect a notable minority of adults (pooled estimates around 2.5% persistent, "
        "higher for symptomatic). Yet productivity apps ignore wellbeing, and therapy apps see no behavioural data.",
        "<b>Privacy blocks adoption.</b> Professionals and employers resist tools that upload browsing "
        "history to a vendor cloud, and resistance is even stronger when mental health is involved.",
    ])
    s.append(H2("Market sizing"))
    s.extend(fig(charts["market"], "TAM / SAM / SOM, bottom-up. TAM uses the commonly cited ~1B knowledge-worker "
                                   "estimate multiplied by Pro list price.", width=CONTENT_W * 0.74))
    s.append(H2("Target customers"))
    s += table([
        ["Segment", "Who", "Primary tier", "Buying trigger"],
        ["ADHD & focus-challenged professionals", "Diagnosed or self-identified; often already in therapy or "
         "coaching", "Mind, Pro", "Wants structure without shame; wants therapist to “see” the week"],
        ["Privacy-conscious developers", "Engineers who reject cloud trackers", "Free → Pro",
         "Local LLM, open architecture, stand-up generator"],
        ["Students (exam prep, research)", "College & competitive-exam students, especially in India",
         "Pro (student 50% off)", "Exam season, parental / mentor encouragement"],
        ["Remote & hybrid teams", "Startups and agencies, 10–200 people", "Teams",
         "Meeting overload, deep-work culture, burnout"],
        ["HR / People / Wellbeing buyers", "Mid-market & enterprise, 200+ employees", "Enterprise Wellbeing",
         "EAP under-use, burnout metrics, retention"],
        ["Psychologists (supply side)", "RCI-registered (India) or state-licensed (US) clinicians",
         "Partner", "Steady client flow, better between-session data, flexible hours"],
    ], [0.24, 0.3, 0.16, 0.30], bold_first_col=True, caption="Table 3.1 — Customer segments")

    # ── 4 Business impact
    s += H1("4", "Business Impact", "Impact")
    s.append(P("Sheru creates value for four parties. The numbers below are the economic case each buyer will "
               "test, and the pilot programme (Section 13) is designed to measure them directly."))
    s.append(H2("For individual users"))
    s.append(P("Even modest recovered focus time pays for the subscription many times over. At 25 minutes a day "
               "over 220 working days, a user regains about 92 hours a year. Valued at a conservative $12/hour (India) "
               "that is about $1,100; at $40/hour it is about $3,700. Pro costs $96 a year at full global list price."))
    s.extend(fig(charts["roi"], "Annual value of recovered time vs. Pro price. Illustrative; the time-recovered "
                                "figure will be measured in the pilot."))
    s.append(H2("For employers (Teams & Enterprise Wellbeing)"))
    team = 100
    val = team * 20 / 60 * 220 * 30
    cost = team * 10 * 12
    s += table([
        ["Impact lever", "Mechanism", "Illustrative value (100-person team)"],
        ["Recovered deep-work time", "Real-time nudges, calendar focus blocks, Slack DND sync",
         f"20 min/day × 220 days × $30/hr ≈ <b>{money(val)}</b> vs. {money(cost)} Teams cost "
         f"(<b>{val / cost:.0f}×</b>)"],
        ["Faster stand-ups & reporting", "AI stand-ups from real activity", "~10 min/person/day of status "
         "writing removed"],
        ["Burnout early warning", "Anonymised trends in switch rate and after-hours work (k ≥ 5)",
         "Earlier intervention; lower regretted attrition (to validate)"],
        ["Higher EAP utilisation", "Psychologist access inside a tool people already open daily",
         "Typical EAPs see low single-digit usage; embedded access targets 8%+ monthly"],
    ], [0.24, 0.38, 0.38], bold_first_col=True, caption="Table 4.1 — Employer value levers")
    s.append(H2("For psychologists"))
    s += B([
        "<b>Steady demand without marketing.</b> Matched clients arrive pre-screened, and payouts are predictable "
        f"(about {CLINICIAN_SHARE_MIND:.0%} of the Mind fee).",
        "<b>Objective between-session data.</b> The Focus Report shows patterns clients cannot recall "
        "accurately: when focus collapses, which triggers recur, and how sleep-time browsing trends.",
        "<b>Homework that actually runs.</b> Goals set in session become live nudges in the browser. "
        "This closes the gap between the therapy room and the workday.",
    ])
    s.append(H2("For Sheru as a company"))
    s += B([
        "Mind raises ARPU about 7× over Pro and creates the strongest switching cost: a relationship with a clinician.",
        "B2B tiers bring low churn (1–1.5% monthly) and annual contracts, which stabilise cash flow.",
        "Outcome data (self-reported wellbeing and focus trends, anonymised) builds a defensible evidence "
        "base for insurer and enterprise sales.",
    ])

    # ── 5 Mind
    s += H1("5", "Sheru Mind — Monthly Psychologist Care", "New feature")
    s.append(P("Sheru Mind is the flagship new feature. Members get a monthly relationship with a matched "
               "psychologist who specialises in attention, ADHD, burnout or performance anxiety. The extension "
               "becomes the bridge between sessions.", "lead"))
    s.extend(fig(charts["cycle"], "The Sheru Mind monthly care loop.", width=CONTENT_W))
    s.append(H2("What a member gets each month"))
    s += table([
        ["Component", "Detail"],
        ["1 × 50-minute video session", "Scheduled in-app with the matched psychologist. Reschedule up to 24h "
         "before. Extra sessions available as an add-on."],
        ["Focus Report (consent-gated)", "Generated locally from ActivityWatch + focus scores: weekly focus trend, "
         "distraction hot-hours, context-switch rate, session completion, mood/energy check-ins. The member "
         "previews it and chooses what to share. Raw URLs are never included by default."],
        ["Async check-ins", "Secure messaging with the psychologist; response within 2 business days. Weekly "
         "structured check-in prompts."],
        ["Plan → nudges", "Goals and coping strategies set in session flow into the extension. Examples: nudge tone "
         "(gentle vs. firm), deep-work block length, wind-down reminders, break suggestions."],
        ["Daily 1-tap mood & energy", "In the side panel; feeds the Focus Report and burnout detection."],
        ["Progress measures", "Monthly WHO-5 Well-Being Index and ASRS-based self-report (non-diagnostic), "
         "shown to member and psychologist."],
    ], [0.28, 0.72], bold_first_col=True, caption="Table 5.1 — Mind membership contents")
    s.append(H2("Psychologist portal"))
    s += B([
        "Client roster with pre-session brief (shared Focus Report and last check-ins).",
        "Encrypted session notes (clinician-owned), goal-setting UI that pushes to the client's extension.",
        "Calendar and availability, video room, async inbox, payouts and earnings dashboard.",
        "Caseload cap and utilisation view, so quality is protected and no clinician is overbooked.",
    ])
    s.append(H2("Matching, credentialing and safety"))
    s += table([
        ["Area", "Policy"],
        ["Credentialing", "India: RCI-registered clinical psychologists, or counselling psychologists with "
         "recognised postgraduate qualifications, verified on onboarding. US/EU (2028+): licensed in the "
         "member's state/country. Annual re-verification and peer supervision."],
        ["Matching", "Intake questionnaire (goals, ASRS v1.1 screener, language, timezone, preferences). The algorithm "
         "proposes 3 clinicians and the member chooses. A free switch is available any time."],
        ["Scope", "Mind is psychological support and coaching for focus and wellbeing. It is <b>not</b> an "
         "emergency service and does <b>not</b> diagnose or prescribe. Psychiatric needs are referred out."],
        ["Crisis protocol", "Crisis language in check-ins triggers immediate in-app helplines (India Tele-MANAS "
         "14416; US 988; local equivalents) and a same-day clinician escalation. Protocol is reviewed by a "
         "clinical advisory board."],
        ["Quality", "Session ratings, outcome trends, random case audits, clinician NPS, and a cap of about "
         f"{SESSIONS_PER_CLINICIAN} members per full-time psychologist."],
    ], [0.2, 0.8], bold_first_col=True, caption="Table 5.2 — Clinical governance")
    s += callout("Why monthly, not weekly?",
                 "Weekly therapy costs 4× more and suits acute needs. Mind targets sub-clinical, persistent "
                 "focus and burnout problems. There, a monthly session plus a daily in-browser coach is a "
                 "better price-to-value fit. Members who need more can add sessions, and clinicians can recommend "
                 "a higher-intensity external service.")

    # ── 6 SaaS + subscription features
    s += H1("6", "SaaS Platform & Subscription Features", "New features")
    s.append(H2("Core SaaS capabilities"))
    s += table([
        ["Feature", "Description", "Tier"],
        ["Accounts & licensing", "Email / Google / passkey sign-in; signed licence token cached in the "
         "extension so it works offline", "All"],
        ["Opt-in E2EE sync", "Aggregates (focus scores, category minutes, sessions) encrypted on-device; "
         "server stores ciphertext only. Multi-device history.", "Pro+"],
        ["Hosted dashboard", "The Pulse dashboard as a web app: unlimited history, trends, weekly AI coach "
         "report by email", "Pro+"],
        ["Integrations", "Google / Outlook calendar focus blocks, Slack status & DND, Jira / Linear / GitHub "
         "for richer stand-ups", "Pro+"],
        ["Burnout detection", "Switch-rate, after-hours and streak analysis → break suggestions and "
         "weekly risk signal", "Pro+"],
        ["Focus rooms", "Body-doubling: join a silent co-working room with live focus status", "Pro+"],
        ["Team workspaces", "Invites, seat management, shared focus norms, team stand-ups", "Teams+"],
        ["Team insights", "Aggregated, anonymised trends with k-anonymity ≥ 5. No individual browsing view, "
         "by design.", "Teams+"],
        ["SSO / SCIM / audit log", "Okta, Azure AD, Google Workspace provisioning; admin audit trail",
         "Enterprise"],
        ["Pooled psychologist access", "Employer-funded sessions with confidential booking; employer sees "
         "only utilisation counts", "Enterprise"],
        ["Desktop & mobile apps", "Native focus tracking outside the browser; mobile check-ins & session "
         "joining", "Pro+"],
    ], [0.22, 0.62, 0.16], bold_first_col=True, caption="Table 6.1 — SaaS feature set by tier")
    s.append(H2("Subscription & billing system"))
    s += table([
        ["Capability", "Implementation"],
        ["Payment rails", "Stripe (global cards, Apple/Google Pay) and Razorpay (India: UPI AutoPay "
         "mandates, cards, net-banking) behind one internal billing service"],
        ["Plans", "Monthly and annual (2 months free), regional pricing by country, student plan, family plan "
         "(up to 4), seat-based Teams, annual Enterprise contracts with invoicing"],
        ["Lifecycle", "Trialing → Active → Past due (smart retries, 3 dunning emails over 10 days) → "
         "Grace (read-only) → Cancelled; pause up to 3 months; win-back offers"],
        ["Changes", "Instant upgrades with proration; downgrades at period end; Mind add-on sessions billed "
         "per use"],
        ["Entitlements", "Billing events → entitlement service → signed licence token; the extension re-checks "
         "daily and degrades gracefully to Free offline"],
        ["Tax & compliance", "GST invoicing (India), VAT/OSS (EU), sales tax via the provider; RBI e-mandate "
         "rules for recurring Indian payments"],
        ["Clinician payouts", "Monthly payouts per completed session + check-in stipend; TDS handling "
         "(India); payout statements in the portal"],
    ], [0.22, 0.78], bold_first_col=True, caption="Table 6.2 — Subscription mechanics")

    # ── 7 Pricing
    s += H1("7", "Pricing & Packaging", "Monetisation")
    s += table([
        ["Tier", "Global price", "India price", "Who it's for", "Key inclusions"],
        ["Free", "$0", "INR 0", "Everyone", "Local AI classification, nudges, side panel, 7-day local "
         "dashboard. No account needed."],
        ["Pro", "$8/mo · $72/yr", "INR 299/mo · INR 2,499/yr", "Individuals",
         "Sync, unlimited history, hosted dashboard, AI coach report, integrations, burnout detection, focus rooms"],
        ["Mind", "$69/mo (US: $129, 2028)", "INR 2,499/mo", "Individuals wanting care",
         "Everything in Pro + monthly 50-min psychologist session, async check-ins, Focus Report, mood tracking"],
        ["Teams", "$10/seat/mo (annual)", "INR 399/seat/mo", "Teams 5–200",
         "Pro for all + workspace, team insights (k ≥ 5), admin, shared stand-ups"],
        ["Enterprise Wellbeing", "From $18/employee/mo", "Custom", "200+ employees",
         "Teams + SSO/SCIM, pooled psychologist sessions, wellbeing reporting, DPA, SLA"],
    ], [0.13, 0.17, 0.18, 0.16, 0.36], bold_first_col=True, caption="Table 7.1 — Price book")
    s += table([
        ["Add-on", "Price"],
        ["Extra psychologist session (50 min)", "$39 · INR 1,299"],
        ["Student discount (Pro)", "50% with verified student email"],
        ["Family plan (Pro, up to 4)", "$14/mo · INR 549/mo"],
        ["Mind for Teams (per enrolled employee)", "Volume-priced, from $35/mo"],
    ], [0.6, 0.4], bold_first_col=True, caption="Table 7.2 — Add-ons")
    s += callout("Pricing rationale",
                 "Pro is anchored below mainstream productivity apps so the free-to-paid jump is easy. Mind is "
                 "priced well below the cost of four monthly therapy sessions, yet high enough for about 50% clinician payout. "
                 "India pricing reflects purchasing power and lets the clinician network start where qualified "
                 "supply is affordable. The model uses lower blended ARPUs than list prices to account for "
                 "regional mix and annual discounts.")

    # ── 8 Architecture
    s += H1("8", "SaaS Architecture & Privacy Model", "Technology")
    s.append(P("The core principle is <b>local-first, consent-based sync</b>. Everything Sheru does today keeps "
               "running on the device with no account. The cloud layer is additive and only ever receives what "
               "the user explicitly allows, encrypted on-device."))
    s.extend(fig(charts["arch"], "Target architecture. The left zone is today's repository; centre and right are new."))
    s += table([
        ["Data class", "Stays on device", "Syncs (opt-in, E2EE)", "Who can read it"],
        ["Raw URLs & page titles", "Always", "Never by default", "User only"],
        ["Focus scores & categories (per minute)", "Yes", "Pro+ sync", "User's devices"],
        ["Daily aggregates & Focus Report", "Yes", "When shared", "User + chosen psychologist"],
        ["Mood / energy check-ins", "Yes", "Mind members", "User + psychologist"],
        ["Session notes", "—", "Clinician-owned, encrypted", "Psychologist (user on request)"],
        ["Team metrics", "—", "Aggregated server-side", "Admins, only if ≥ 5 members"],
        ["Billing data", "—", "Held by payment provider", "Billing service"],
    ], [0.3, 0.17, 0.25, 0.28], bold_first_col=True, caption="Table 8.1 — Data classification & visibility")

    # ── 9 Financials
    s += H1("9", "Five-Year Financial Projections", "Financials")
    s.append(P("Base-case model, annual granularity, starting with a public launch in early 2027. All figures in "
               "USD. Assumptions are listed in Appendix A and in the generator script, so every chart can be "
               "re-run with different inputs."))
    s.extend(fig(charts["seats"], "Paying seats by tier at year end."))
    s.extend(fig(charts["revenue"], "Revenue by stream."))
    s.extend(fig(charts["mix"], "2031 revenue mix."))
    s.extend(fig(charts["arr"], "Exit ARR under three adoption scenarios."))
    s.extend(fig(charts["pnl"], "Revenue, total cost and EBITDA."))
    rows = [["USD", *YEARS]]
    def row(lbl, vals, f=money):
        return [lbl, *[f(v) for v in vals]]
    rows += [
        row("Registered users", USERS_END, num),
        row("Paying seats", M["paid_seats_end"], num),
        row("Revenue", M["rev"]),
        row("&nbsp;&nbsp;&nbsp;&nbsp;Pro", M["rev_pro"]),
        row("&nbsp;&nbsp;&nbsp;&nbsp;Mind", M["rev_mind"]),
        row("&nbsp;&nbsp;&nbsp;&nbsp;Teams", M["rev_teams"]),
        row("&nbsp;&nbsp;&nbsp;&nbsp;Enterprise Wellbeing", M["rev_ent"]),
        row("Cost of revenue", M["cogs"]),
        row("&nbsp;&nbsp;&nbsp;&nbsp;of which psychologist payouts", M["cogs_clin"]),
        row("Gross profit", M["gp"]),
        row("Gross margin", M["gm"], lambda v: f"{v:.0%}"),
        row("Operating expenses", M["opex"]),
        row("EBITDA", M["ebitda"]),
        row("Cumulative EBITDA", M["cum_ebitda"]),
        row("Exit ARR", M["arr_exit"]),
        row("Headcount", HEADCOUNT, lambda v: f"{v}"),
    ]
    s += table(rows, [0.3] + [0.14] * 5, bold_first_col=True, align_right_from=1,
               caption="Table 9.1 — Summary P&amp;L (base case)")
    s.extend(fig(charts["unit"], "LTV vs. CAC by tier. LTV = ARPU × gross margin ÷ monthly churn."))
    s += table([
        ["Tier", "ARPU / mo", "Gross margin", "Monthly churn", "CAC", "LTV", "LTV/CAC", "Payback"],
        *[[t, f"${v['arpu']:.0f}" if v['arpu'] >= 10 else f"${v['arpu']:.2f}", f"{v['gm']:.0%}",
           f"{v['churn']:.1%}", f"${v['cac']}", f"${v['ltv']:,.0f}", f"{v['ratio']:.1f}×",
           f"{v['payback']:.1f} mo"] for t, v in u.items()],
    ], [0.2, 0.1, 0.11, 0.11, 0.08, 0.1, 0.12, 0.18], bold_first_col=True, align_right_from=1,
        caption="Table 9.2 — Unit economics")
    s += callout("Reading the numbers",
                 f"Mind has the lowest gross margin ({u['Mind']['gm']:.0%}) because roughly half the fee goes to the "
                 "psychologist, but it has the highest absolute LTV among individual tiers. Mind is also the main "
                 "reason members stay subscribed to Pro features. Teams and Enterprise carry the "
                 "business long-term: low churn, annual prepayment and LTV/CAC around 5×.")

    # ── 10 Scalability
    s += H1("10", "Scalability Options", "Scale")
    s.append(P("Scaling Sheru is unusual. The expensive part of most AI products, inference, does not "
               "grow with users here. The constraints that do grow are sync storage, video, clinician supply "
               "and compliance. Each needs its own scaling plan."))
    s.append(H2("10.1 Technical scaling stages"))
    s += table([
        ["Stage", "Scale", "Architecture", "Key investments"],
        ["1 · Launch", "≤ 10K paid", "Single region (Mumbai), managed Postgres, serverless API, hosted "
         "video & payments", "CI/CD, error tracking, backups, pen-test"],
        ["2 · Growth", "10K–100K paid", "Multi-AZ, read replicas, Redis, queue workers for reports, CDN for "
         "extension updates", "SOC 2 Type II, on-call, feature flags, cost dashboards"],
        ["3 · Global", "100K+ paid / 1M+ users", "Multi-region with data residency (IN, EU, US), tenant-"
         "sharded Postgres, event streaming, dedicated scheduling service", "HIPAA-eligible stack, ISO 27001, "
         "regional clinician ops"],
    ], [0.13, 0.15, 0.42, 0.30], bold_first_col=True, caption="Table 10.1 — Infrastructure roadmap")
    s.extend(fig(charts["infra"], "Per-user infra cost. A cloud-AI model assumes ~400 classifications/user/day "
                                  "× ~300 tokens ≈ 3.6M tokens/month at ~$0.30 per million tokens."))
    s.append(H2("10.2 Clinician network scaling"))
    s.append(P(f"Clinician supply is the main operational constraint. One full-time psychologist can carry about "
               f"{SESSIONS_PER_CLINICIAN} Mind members (one session each plus async check-ins). The base case needs "
               f"about {M['clin_mind'][-1] + M['clin_ent'][-1]:,.0f} FTE psychologists by 2031, "
               "mostly part-time contractors."))
    s.extend(fig(charts["clin"], "Psychologist FTE requirement."))
    s += B([
        "<b>Supply levers:</b> university and RCI partnerships, supervised associate tier, part-time contracts, "
        "referral bonuses, and a portal that cuts admin time.",
        "<b>Efficiency levers:</b> AI-drafted pre-session briefs from the Focus Report (clinician-reviewed), group "
        "sessions for common themes (e.g., ADHD at work), and structured check-in templates.",
        "<b>Quality guardrails:</b> hard caseload caps, supervision ratios, and outcome monitoring before each "
        "hiring wave.",
    ])
    s.append(H2("10.3 Strategic scaling options"))
    s += table([
        ["Option", "What it means", "Investment", "Time to value", "Upside", "Risk"],
        ["A · B2C depth (India first)", "Grow Free → Pro → Mind in India, then SEA", "Low", "3–6 mo",
         "Medium", "Low ARPU"],
        ["B · B2B Teams", "Bottom-up from individual users to team plans", "Medium", "6–12 mo", "High",
         "Surveillance perception"],
        ["C · Enterprise Wellbeing / EAP", "Sell as a wellbeing benefit, incl. pooled therapy", "High",
         "12–18 mo", "Very high", "Long sales cycles"],
        ["D · B2B2C via insurers & universities", "Distribution through health insurers, campuses",
         "Medium", "12–24 mo", "Very high", "Partner dependency"],
        ["E · Platform / API", "Licence the local focus engine to other apps (on-device SDK)", "Medium",
         "18+ mo", "High", "Focus dilution"],
        ["F · Geographic expansion", "US / UK / EU with locally licensed clinicians", "High", "12–24 mo",
         "Very high", "Regulation, clinician cost"],
    ], [0.19, 0.28, 0.135, 0.125, 0.11, 0.16], bold_first_col=True, caption="Table 10.2 — Scaling options compared")
    s += callout("Recommended sequence",
                 "A → B → C, with D opened opportunistically. Prove Mind retention in India (A), let users pull "
                 "Sheru into their teams (B), then turn anonymised outcome data into the Enterprise Wellbeing "
                 "sale (C). Expand geographically (F) only once clinical operations are repeatable.", color=S1)

    # ── 11 GTM
    s += H1("11", "Go-to-Market", "Growth")
    s.extend(fig(charts["funnel"], "Target funnel; benchmarks to be replaced with measured data after launch."))
    s += table([
        ["Channel", "Tactic", "Primary tier"],
        ["Chrome Web Store & SEO", "Store optimisation, “ADHD focus extension”, “privacy time tracker” content",
         "Free → Pro"],
        ["Developer community", "Open-source local engine, GitHub, Hacker News, Product Hunt launch", "Free → Pro"],
        ["ADHD & mental-health creators", "Partnerships with creators and communities; psychologist-led "
         "webinars", "Mind"],
        ["Psychologist referrals", "Clinicians invite existing clients to use Sheru between sessions",
         "Mind"],
        ["Campus programmes", "Student ambassadors, exam-season campaigns, institutional licences", "Pro"],
        ["Product-led B2B", "“Invite your team” in-product, team trials, usage-based expansion", "Teams"],
        ["Direct sales & HR channels", "HR-tech marketplaces, benefits brokers, wellbeing conferences",
         "Enterprise"],
    ], [0.25, 0.55, 0.2], bold_first_col=True, caption="Table 11.1 — Acquisition channels")

    # ── 12 Risk & compliance
    s += H1("12", "Compliance, Privacy & Risk", "Governance")
    s.append(H2("12.1 Regulatory map"))
    s += table([
        ["Jurisdiction", "Regime", "What it requires of Sheru"],
        ["India", "Digital Personal Data Protection Act 2023 (+ Rules)", "Notice & consent, purpose "
         "limitation, data-principal rights, breach reporting, grievance officer"],
        ["India", "Mental Healthcare Act 2017; RCI norms", "Confidentiality of mental-health information; "
         "qualified, registered professionals"],
        ["India", "RBI e-mandate rules", "Pre-debit notification and authentication for recurring payments"],
        ["EU / UK", "GDPR / UK GDPR", "Health data is special-category: explicit consent, DPIA, EU data "
         "residency, DPAs with employers"],
        ["US", "HIPAA (if acting with covered entities), state licensure, FTC Health Breach Notification Rule",
         "BAAs, HIPAA-eligible infra, state-licensed clinicians, no deceptive health claims"],
        ["All", "Chrome Web Store policies", "Limited-use data disclosure, single purpose, privacy policy"],
    ], [0.13, 0.32, 0.55], bold_first_col=True, caption="Table 12.1 — Compliance obligations (to be confirmed "
                                                         "with counsel)")
    s.extend(fig(charts["risk"], "Risk heat map."))
    s += table([
        ["#", "Risk", "Mitigation"],
        ["1", "Clinical safety incident", "Crisis protocol, helplines, clinical advisory board, insurance, "
         "clear scope (not an emergency service)"],
        ["2", "Breach of synced data", "E2EE (server holds ciphertext), minimal data, pen-tests, SOC 2, "
         "bug bounty"],
        ["3", "Psychologist supply & quality", "Multi-channel recruiting, caseload caps, supervision, outcome "
         "monitoring"],
        ["4", "Low free → paid conversion", "Value-gated features (history, sync, reports), trials, Mind as "
         "premium anchor"],
        ["5", "Employer misuse as surveillance", "k-anonymity ≥ 5, no individual view by design, contractual "
         "restrictions"],
        ["6", "Health-data regulation shifts", "Privacy-by-design, regional residency, compliance budget"],
        ["7", "Big-tech bundled focus modes", "Differentiate on care + context-aware AI + privacy"],
        ["8", "Chrome Web Store / MV3 policy", "Strict policy compliance, desktop app as second surface"],
        ["9", "Local LLM speed on low-end PCs", "Smaller quantised models, heuristic fallback (already in "
         "repo), optional private cloud inference"],
    ], [0.05, 0.3, 0.65], caption="Table 12.2 — Risk register")

    # ── 13 Roadmap
    s += H1("13", "Roadmap & Milestones", "Execution")
    s.extend(fig(charts["roadmap"], "Execution roadmap, Q4 2026 – Q4 2028."))
    s += table([
        ["Milestone", "Target", "Success criterion"],
        ["Web Store launch + Pro billing live", "Q1 2027", "5K installs; first 100 paying users"],
        ["Mind pilot (India, 10 psychologists, ~300 members)", "Q3 2027",
         "≥ 75% month-3 retention; session attendance ≥ 85%; WHO-5 improvement"],
        ["Teams GA", "Q1 2028", "25 paying teams; net revenue retention ≥ 110%"],
        ["First Enterprise Wellbeing contracts", "Q4 2028", "3 logos, ≥ 1,000 seats; SOC 2 Type II"],
        ["EBITDA break-even", M["breakeven"], f"Exit ARR ≥ {money(M['arr_exit'][YEARS.index(M['breakeven'])] if M['breakeven'] in YEARS else 0)}"],
    ], [0.42, 0.14, 0.44], bold_first_col=True, caption="Table 13.1 — Milestones")

    # ── 14 KPIs
    s += H1("14", "KPIs & Success Metrics", "Measurement")
    s += table([
        ["Layer", "Metric", "Target"],
        ["North star", "Weekly focused hours per active user", "+20% vs. first-week baseline by week 6"],
        ["Activation", "Install → first focus session within 24h", "≥ 60%"],
        ["Engagement", "D30 weekly-active retention", "≥ 30%"],
        ["Monetisation", "Free → paid conversion (12 months)", "≥ 5%"],
        ["Revenue", "MRR growth · Net revenue retention (B2B)", "15% MoM early · ≥ 110%"],
        ["Mind quality", "Session attendance · Session CSAT · Month-3 retention", "≥ 85% · ≥ 4.6/5 · ≥ 75%"],
        ["Outcomes", "WHO-5 change · self-reported focus change", "Meaningful improvement by month 3"],
        ["Clinician ops", "Utilisation · clinician NPS · time-to-first-session", "70–85% · ≥ 50 · < 72h"],
        ["Trust", "Data incidents · % users enabling sync", "0 · tracked"],
    ], [0.16, 0.45, 0.39], bold_first_col=True, caption="Table 14.1 — KPI tree")

    # ── Appendix
    s += H1("A", "Appendix — Model Assumptions & Sources", "Appendix")
    s += table([
        ["Assumption", "Value", "Note"],
        ["Registered users (year end)", " · ".join(num(x) for x in USERS_END), "2027 → 2031"],
        ["Pro share of users", " · ".join(f"{x:.1%}" for x in PRO_RATE), "Freemium benchmark range"],
        ["Mind share of users", " · ".join(f"{x:.1%}" for x in MIND_RATE), "Premium care tier"],
        ["Teams seats (year end)", " · ".join(num(x) if x else "0" for x in TEAMS_SEATS_END), "From 2028"],
        ["Enterprise seats (year end)", " · ".join(num(x) if x else "0" for x in ENT_SEATS_END), "From 2029"],
        ["Blended ARPU Pro / Mind", f"${ARPU_PRO[0]}→${ARPU_PRO[-1]} / ${ARPU_MIND[0]}→${ARPU_MIND[-1]}",
         "India-heavy early mix"],
        ["Blended ARPU Teams / Enterprise", f"${ARPU_TEAMS[0]} / ${ARPU_ENT[0]} per seat", "Annual contracts"],
        ["Psychologist payout", f"{CLINICIAN_SHARE_MIND:.0%} of Mind; {CLINICIAN_SHARE_ENT:.0%} of Enterprise",
         "Per completed session"],
        ["Infra cost", f"${INFRA_FREE:.2f} free / ${INFRA_PAID:.2f} paid per month; ${VIDEO_PER_SESSION:.2f} per "
                       "video session", "No inference cost (local LLM)"],
        ["Payments + support", f"{PAYMENTS_PCT:.0%} + {SUPPORT_PCT:.0%} of revenue", ""],
        ["Headcount", " · ".join(str(h) for h in HEADCOUNT), "India-based core team"],
        ["Marketing", " · ".join(money(x) for x in MARKETING), ""],
        ["Clinician capacity", f"{SESSIONS_PER_CLINICIAN} Mind members per FTE", ""],
    ], [0.3, 0.45, 0.25], bold_first_col=True, caption="Table A.1 — Model inputs")
    s.append(H2("Sources & notes", toc=False))
    s += B([
        "World Health Organization, <i>Mental health at work</i> (2022): ~12 billion working days lost each year "
        "to depression and anxiety, costing about US$1 trillion in productivity.",
        "Gartner's widely cited estimate of ~1 billion knowledge workers worldwide (used for TAM).",
        "Song P. et al., <i>Journal of Global Health</i> (2021): global prevalence of adult ADHD (persistent ≈ 2.6%; "
        "symptomatic ≈ 6.8%).",
        "WHO-5 Well-Being Index and the WHO Adult ADHD Self-Report Scale (ASRS v1.1) are publicly available "
        "screening instruments. Sheru uses them only for non-diagnostic self-tracking.",
        "Helplines: India Tele-MANAS 14416; US 988 Suicide &amp; Crisis Lifeline.",
        "Before external use, verify these figures against the latest editions. Financial projections are "
        "illustrative planning estimates, not forecasts or guarantees. Regulatory points are a starting checklist, "
        "not legal advice.",
    ])
    s.append(Spacer(1, 6))
    s.append(P("<i>Regenerate this document with:</i> "
               "<font face='Courier' size='8.5'>uv run --with reportlab --with matplotlib python "
               "docs/business/build_business_plan.py</font>", "body"))
    return s


def main():
    doc = Doc(str(PDF_PATH))
    doc.multiBuild(story())
    print(f"wrote {PDF_PATH}")
    print("revenue", [money(x) for x in M["rev"]])
    print("ebitda ", [money(x) for x in M["ebitda"]])
    print("cum    ", [money(x) for x in M["cum_ebitda"]])
    print("gm     ", [f"{x:.0%}" for x in M["gm"]])
    print("arr    ", [money(x) for x in M["arr_exit"]])
    print("break-even", M["breakeven"], "peak burn", money(M["peak_burn"]))


if __name__ == "__main__":
    main()
