#!/usr/bin/env python3
"""
fetch_prices.py
GitHub Actions에서 매일 09:00 KST 실행 → LME 가격 수집 후 data.json 업데이트
"""

import json
import logging
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

# Windows 환경에서 UTF-8 출력 보장 (이모지 등 non-BMP 문자 처리)
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

import requests
from bs4 import BeautifulSoup

# ── 설정 ──────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
NOW_KST = datetime.now(KST)
TODAY: date = NOW_KST.date()
TODAY_STR: str = TODAY.strftime("%Y-%m-%d")

DATA_FILE = "data.json"
MAX_HISTORY = 400
REQUEST_TIMEOUT = 30
LME_DELAY = 3  # LME 요청 간격 (초)

EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest/USD"

LME_URLS: dict[str, str] = {
    "nickel":    "https://www.lme.com/en/metals/non-ferrous/lme-nickel",
    "cobalt":    "https://www.lme.com/en/metals/ev/lme-cobalt-fastmarkets-mb",
    "aluminium": "https://www.lme.com/en/metals/non-ferrous/lme-aluminium",
    "lioh":      "https://www.lme.com/en/metals/ev/lme-lithium-hydroxide-cif-fastmarkets-mb",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


# ── 환율 수집 ─────────────────────────────────────────────────────────────────
def fetch_exchange_rate() -> Optional[float]:
    try:
        resp = requests.get(EXCHANGE_RATE_URL, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        rate = data["rates"]["KRW"]
        log.info("환율 수집 성공: USD/KRW = %.2f", rate)
        return round(float(rate), 2)
    except Exception as e:
        log.error("환율 수집 실패: %s", e)
        return None


# ── LME 페이지 파싱 ───────────────────────────────────────────────────────────
def _extract_price_from_text(text: str, min_val: float = 10.0) -> Optional[float]:
    """쉼표 제거 후 숫자 추출. min_val 미만은 무시."""
    cleaned = text.replace(",", "").strip()
    m = re.search(r"\d[\d.]*", cleaned)
    if m:
        val = float(m.group())
        if val >= min_val:
            return val
    return None


def _parse_lme_html(html: str, key: str) -> Optional[float]:
    """
    여러 전략으로 LME 페이지 HTML에서 현물(cash) 가격 추출.
    LME는 SPA이므로 정적 HTML에 가격이 없을 수 있음 → None 반환.
    """
    soup = BeautifulSoup(html, "lxml")

    # 전략 1: JSON-LD structured data
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            obj = json.loads(script.string or "")
            # offers.price or price 키 탐색
            for price_key in ("price", "cashPrice", "cash", "settlementPrice"):
                if isinstance(obj, dict) and price_key in obj:
                    val = _extract_price_from_text(str(obj[price_key]))
                    if val:
                        log.debug("[%s] JSON-LD 전략 성공: %.2f", key, val)
                        return val
        except (json.JSONDecodeError, TypeError):
            pass

    # 전략 2: <script> 내부 JS 변수/객체에서 가격 패턴 검색
    price_patterns = [
        r'"cash(?:Price|Settlement|price|settlement)"\s*:\s*"?([0-9,]+\.?[0-9]*)"?',
        r'"(?:official|settlement|cash)[Pp]rice"\s*:\s*"?([0-9,]+\.?[0-9]*)"?',
        r'(?:cashPrice|cash_price|settlementPrice)\s*[=:]\s*"?([0-9,]+\.?[0-9]*)"?',
        r'"price"\s*:\s*"?([0-9,]+\.?[0-9]*)"?',
    ]
    for script in soup.find_all("script"):
        text = script.string or ""
        if not text.strip():
            continue
        for pat in price_patterns:
            for m in re.finditer(pat, text):
                val = _extract_price_from_text(m.group(1))
                if val and val > 100:
                    log.debug("[%s] JS 변수 전략 성공: %.2f", key, val)
                    return val

    # 전략 3: CSS 클래스/속성 기반 셀렉터
    selectors = [
        "[class*='cash-price']",
        "[class*='cashPrice']",
        "[class*='cash_price']",
        "[class*='settlement-price']",
        "[class*='settlementPrice']",
        "[class*='price__value']",
        "[class*='price-value']",
        "[class*='lme-price']",
        "[data-price]",
        "span.price",
        "div.price",
        "td.price",
    ]
    for sel in selectors:
        el = soup.select_one(sel)
        if el:
            val = _extract_price_from_text(el.get_text())
            if val and val > 10:
                log.debug("[%s] CSS 셀렉터(%s) 전략 성공: %.2f", key, sel, val)
                return val

    # 전략 4: 테이블에서 'Cash' 행 탐색
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            for i, cell in enumerate(cells):
                cell_text = cell.get_text(strip=True).lower()
                if cell_text in ("cash", "official", "settlement"):
                    for j in range(i + 1, min(i + 4, len(cells))):
                        val = _extract_price_from_text(cells[j].get_text())
                        if val and val > 10:
                            log.debug("[%s] 테이블 전략 성공: %.2f", key, val)
                            return val

    log.warning("[%s] 모든 파싱 전략 실패 (JavaScript 렌더링 필요 가능성)", key)
    return None


def fetch_lme_price(key: str, url: str) -> Optional[float]:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        price = _parse_lme_html(resp.text, key)
        if price is not None:
            log.info("[%s] LME 수집 성공: %.2f", key, price)
        else:
            log.warning("[%s] HTML 파싱 실패 - 기존값 유지", key)
        return price
    except requests.RequestException as e:
        log.error("[%s] 요청 실패: %s", key, e)
        return None


# ── data.json 업데이트 헬퍼 ───────────────────────────────────────────────────
def calc_monthly_avg(history: list[dict], value_key: str) -> dict:
    """history(oldest→newest)에서 당월/전월 평균 계산"""
    cur_month = TODAY.replace(day=1)
    prev_last = cur_month - timedelta(days=1)
    prev_month = prev_last.replace(day=1)

    cur_vals, prev_vals = [], []
    for item in history:
        d = date.fromisoformat(item["date"])
        v = item[value_key]
        if d.year == cur_month.year and d.month == cur_month.month:
            cur_vals.append(v)
        elif d.year == prev_month.year and d.month == prev_month.month:
            prev_vals.append(v)

    avg = lambda lst: round(sum(lst) / len(lst), 2) if lst else 0
    return {"current_month": avg(cur_vals), "prev_month": avg(prev_vals)}


def already_has_today(history: list[dict], value_key: str) -> bool:
    """history에 오늘 날짜 항목이 있으면 True"""
    return any(item["date"] == TODAY_STR for item in history)


def append_and_trim(history: list[dict], new_item: dict) -> list[dict]:
    """오늘 데이터를 history 끝에 추가하고 MAX_HISTORY 초과분 제거 (oldest 제거)"""
    history.append(new_item)
    if len(history) > MAX_HISTORY:
        history = history[-MAX_HISTORY:]
    return history


# ── 메인 ──────────────────────────────────────────────────────────────────────
def main() -> None:
    # data.json 읽기
    with open(DATA_FILE, encoding="utf-8") as f:
        data = json.load(f)

    results: dict[str, bool] = {}

    # ── 환율 수집 ──────────────────────────────────────────────────────────────
    ex = data["exchange_rate"]
    if already_has_today(ex["history"], "rate"):
        log.info("환율: 오늘 데이터 이미 존재 → 스킵")
        results["환율"] = True
    else:
        rate = fetch_exchange_rate()
        if rate is not None:
            prev_rate = ex["history"][-1]["rate"] if ex["history"] else rate
            chg = round(rate - prev_rate, 2)
            chg_pct = round(chg / prev_rate * 100, 2) if prev_rate else 0

            ex["history"] = append_and_trim(
                ex["history"], {"date": TODAY_STR, "rate": rate}
            )
            ex["latest"] = {
                "date": TODAY_STR,
                "rate": rate,
                "change": chg,
                "change_pct": chg_pct,
            }
            ex["monthly_avg"] = calc_monthly_avg(ex["history"], "rate")
            results["환율"] = True
        else:
            results["환율"] = False

    # ── LME 광물 4종 수집 ──────────────────────────────────────────────────────
    mineral_labels = {
        "lioh":      "LiOH",
        "nickel":    "니켈",
        "cobalt":    "코발트",
        "aluminium": "알루미늄",
    }

    for key, url in LME_URLS.items():
        time.sleep(LME_DELAY)
        mineral = data["minerals"][key]

        if already_has_today(mineral["history"], "price"):
            log.info("[%s] 오늘 데이터 이미 존재 → 스킵", key)
            results[mineral_labels[key]] = True
            continue

        price = fetch_lme_price(key, url)
        if price is not None:
            prev_price = mineral["history"][-1]["price"] if mineral["history"] else price
            chg = round(price - prev_price, 2)
            chg_pct = round(chg / prev_price * 100, 2) if prev_price else 0

            mineral["history"] = append_and_trim(
                mineral["history"], {"date": TODAY_STR, "price": price}
            )
            mineral["latest"] = {
                "date": TODAY_STR,
                "price": price,
                "change": chg,
                "change_pct": chg_pct,
            }
            mineral["monthly_avg"] = calc_monthly_avg(mineral["history"], "price")
            results[mineral_labels[key]] = True
        else:
            results[mineral_labels[key]] = False

    # ── updated_at 갱신 ────────────────────────────────────────────────────────
    data["updated_at"] = NOW_KST.strftime("%Y-%m-%dT%H:%M:%S+09:00")

    # ── data.json 저장 ─────────────────────────────────────────────────────────
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log.info("data.json 저장 완료")

    # ── 수집 결과 요약 출력 ────────────────────────────────────────────────────
    summary = " | ".join(
        f"{label} {'✅' if ok else '❌'}"
        for label, ok in results.items()
    )
    print(f"\n수집 완료: {summary}")

    # 1개라도 실패 시 exit code 1 (GitHub Actions에서 실패 감지용)
    if not all(results.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
