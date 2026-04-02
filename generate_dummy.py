"""
generate_dummy.py
초기 더미 data.json 생성 스크립트 (최초 1회만 실행)
랜덤워크: 전날 값 ±1% 이내 변동, 각 자산별 범위 내 클램프
"""

import json
import random
from datetime import date, timedelta

random.seed(42)

# 최신 가격 기준일 (= 스크립트 실행일 전날)
LATEST_DATE = date(2026, 4, 1)
DAYS = 400
WEEKS = 52


def random_walk(start: float, lo: float, hi: float, n: int, max_pct: float = 0.01):
    """start에서 시작해 n개 값을 생성 (오래된 것 → 최신 순)"""
    values = [start]
    for _ in range(n - 1):
        pct = random.uniform(-max_pct, max_pct)
        nxt = values[-1] * (1 + pct)
        nxt = max(lo, min(hi, nxt))
        values.append(nxt)
    return list(reversed(values))  # [oldest, ..., newest=start]


def make_daily_history(end_date: date, values: list, round_digits: int = 2):
    """values[-1]이 end_date에 대응되도록 날짜 할당"""
    n = len(values)
    history = []
    for i, v in enumerate(values):
        d = end_date - timedelta(days=n - 1 - i)
        history.append({"date": d.strftime("%Y-%m-%d"), "price": round(v, round_digits)})
    return history


def make_rate_history(end_date: date, values: list):
    n = len(values)
    history = []
    for i, v in enumerate(values):
        d = end_date - timedelta(days=n - 1 - i)
        history.append({"date": d.strftime("%Y-%m-%d"), "rate": round(v, 2)})
    return history


def make_weekly_history(end_monday: date, values: list, round_digits: int = 2):
    """52주치 주별 이력 (end_monday가 가장 최신 월요일)"""
    n = len(values)
    history = []
    for i, v in enumerate(values):
        d = end_monday - timedelta(weeks=n - 1 - i)
        history.append({
            "date": d.strftime("%Y-%m-%d"),
            "price": round(v, round_digits),
            "note": "KOMIS",
        })
    return history


# ── 환율 ──────────────────────────────────────────────────────────────────────
rate_latest = 1356.20
rate_vals = random_walk(rate_latest, 1280, 1380, DAYS)
rate_history = make_rate_history(LATEST_DATE, rate_vals)

# ── 수산화리튬 ────────────────────────────────────────────────────────────────
lioh_latest = 9200
lioh_vals = random_walk(lioh_latest, 8000, 13000, DAYS)
lioh_history = make_daily_history(LATEST_DATE, lioh_vals, 0)

# ── 니켈 ──────────────────────────────────────────────────────────────────────
ni_latest = 15230
ni_vals = random_walk(ni_latest, 13000, 18000, DAYS)
ni_history = make_daily_history(LATEST_DATE, ni_vals, 0)

# ── 코발트 ────────────────────────────────────────────────────────────────────
co_latest = 33400
co_vals = random_walk(co_latest, 25000, 40000, DAYS)
co_history = make_daily_history(LATEST_DATE, co_vals, 0)

# ── 알루미늄 ──────────────────────────────────────────────────────────────────
al_latest = 2410
al_vals = random_walk(al_latest, 2100, 2800, DAYS)
al_history = make_daily_history(LATEST_DATE, al_vals, 0)

# ── 망간 (주별): 가장 최신 월요일 찾기 ────────────────────────────────────────
# LATEST_DATE(2026-04-01) 기준 이전 월요일
latest_monday = LATEST_DATE - timedelta(days=LATEST_DATE.weekday())  # 2026-03-30
mn_latest = 4.80
mn_vals = random_walk(mn_latest, 4.5, 5.5, WEEKS)
mn_history = make_weekly_history(latest_monday, mn_vals, 2)


# ── 전일 대비 변동 계산 ────────────────────────────────────────────────────────
def calc_change(history: list, latest_val: float, key: str = "price"):
    if len(history) < 2:
        return 0, 0
    prev = history[-2][key]
    chg = round(latest_val - prev, 4)
    chg_pct = round(chg / prev * 100, 2) if prev else 0
    return chg, chg_pct


rate_chg, rate_chg_pct = calc_change(rate_history, rate_latest, "rate")
lioh_chg, lioh_chg_pct = calc_change(lioh_history, lioh_latest)
ni_chg, ni_chg_pct = calc_change(ni_history, ni_latest)
co_chg, co_chg_pct = calc_change(co_history, co_latest)
al_chg, al_chg_pct = calc_change(al_history, al_latest)

# ── 조립 (monthly_avg는 스펙 명시값 사용) ──────────────────────────────────────
data = {
    "updated_at": "2026-04-02T09:00:00+09:00",
    "exchange_rate": {
        "latest": {
            "date": "2026-04-01",
            "rate": rate_latest,
            "change": rate_chg,
            "change_pct": rate_chg_pct,
        },
        "history": rate_history,
        "monthly_avg": {"current_month": 1348.50, "prev_month": 1335.20},
    },
    "minerals": {
        "lioh": {
            "name": "수산화리튬",
            "unit": "USD/톤",
            "latest": {
                "date": "2026-04-01",
                "price": lioh_latest,
                "change": lioh_chg,
                "change_pct": lioh_chg_pct,
            },
            "history": lioh_history,
            "monthly_avg": {"current_month": 9450, "prev_month": 9800},
        },
        "nickel": {
            "name": "니켈",
            "unit": "USD/톤",
            "latest": {
                "date": "2026-04-01",
                "price": ni_latest,
                "change": ni_chg,
                "change_pct": ni_chg_pct,
            },
            "history": ni_history,
            "monthly_avg": {"current_month": 14980, "prev_month": 15100},
        },
        "cobalt": {
            "name": "코발트",
            "unit": "USD/톤",
            "latest": {
                "date": "2026-04-01",
                "price": co_latest,
                "change": co_chg,
                "change_pct": co_chg_pct,
            },
            "history": co_history,
            "monthly_avg": {"current_month": 32900, "prev_month": 31500},
        },
        "aluminium": {
            "name": "알루미늄",
            "unit": "USD/톤",
            "latest": {
                "date": "2026-04-01",
                "price": al_latest,
                "change": al_chg,
                "change_pct": al_chg_pct,
            },
            "history": al_history,
            "monthly_avg": {"current_month": 2430, "prev_month": 2460},
        },
    },
    "manganese": {
        "name": "망간",
        "unit": "USD/dmtu",
        "latest": {
            "date": "2026-03-31",
            "price": mn_latest,
            "note": "KOMIS",
        },
        "history": mn_history,
        "monthly_avg": {"current_month": 4.75, "prev_month": 4.65},
    },
}

with open("data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("data.json 생성 완료")
print(f"  환율  이력: {len(rate_history)}일  | {rate_history[0]['date']} ~ {rate_history[-1]['date']}")
print(f"  LiOH  이력: {len(lioh_history)}일  | {lioh_history[0]['date']} ~ {lioh_history[-1]['date']}")
print(f"  니켈  이력: {len(ni_history)}일  | {ni_history[0]['date']} ~ {ni_history[-1]['date']}")
print(f"  코발트이력: {len(co_history)}일  | {co_history[0]['date']} ~ {co_history[-1]['date']}")
print(f"  알루미이력: {len(al_history)}일  | {al_history[0]['date']} ~ {al_history[-1]['date']}")
print(f"  망간  이력: {len(mn_history)}주  | {mn_history[0]['date']} ~ {mn_history[-1]['date']}")
