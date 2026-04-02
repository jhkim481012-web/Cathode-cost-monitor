/* ════════════════════════════════════════════════════════════════════════════
   양극소재 원가 모니터링 대시보드 — script.js
   ════════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── 1. 상수 & 전역 상태 ────────────────────────────────────────────────────────

const DATA_URL          = './data.json';
const MANGANESE_LS_KEY  = 'manganese_manual_prices';
const DEFAULT_PERIOD    = 30;

/** Chart.js 라인 색상 */
const LINE_COLORS = {
  'exchange-rate': '#f59e0b',
  lioh:            '#8b5cf6',
  nickel:          '#06b6d4',
  cobalt:          '#10b981',
  aluminium:       '#f97316',
  manganese:       '#ec4899',
};

/** 소수점 자릿수 (카드 표시 & 차트 축) */
const DECIMALS = {
  'exchange-rate': 2,
  lioh:            0,
  nickel:          0,
  cobalt:          0,
  aluminium:       0,
  manganese:       2,
};

const MINERAL_KEYS   = ['lioh', 'nickel', 'cobalt', 'aluminium'];
const ALL_CHART_KEYS = ['exchange-rate', ...MINERAL_KEYS, 'manganese'];

/** 활성 Chart.js 인스턴스 { canvasId → Chart } */
const chartInstances = {};

/** 차트별 활성 기간(일) */
const activePeriods = {};
ALL_CHART_KEYS.forEach(k => (activePeriods[k] = DEFAULT_PERIOD));

/** data.json 캐시 */
let appData = null;

// ── 2. 유틸리티 ────────────────────────────────────────────────────────────────

/**
 * 숫자 형식화 (천단위 콤마 + 소수점)
 * @param {number|null|undefined} val
 * @param {number} decimals
 * @returns {string}
 */
function fmtNum(val, decimals = 0) {
  if (val == null || Number.isNaN(Number(val))) return '--';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(val);
}

/**
 * 차트 X축용 날짜 형식화 "YYYY-MM-DD" → "M/D"
 */
function fmtChartDate(dateStr) {
  const [, mm, dd] = dateStr.split('-');
  return `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;
}

/**
 * 카드 기준일 표시 "YYYY-MM-DD" → "YYYY.MM.DD"
 */
function fmtDisplayDate(dateStr) {
  if (!dateStr) return '--';
  return dateStr.replaceAll('-', '.');
}

/**
 * 날짜 문자열을 로컬 자정 Date 객체로 파싱 (시간대 편차 방지)
 */
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 오늘 날짜 YYYY-MM-DD
 */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * hex 색상 → rgba 문자열
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** XSS 방어용 HTML 이스케이프 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** 요소 텍스트 설정 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ── 3. localStorage 헬퍼 ───────────────────────────────────────────────────────

function getManganeseItems() {
  try {
    return JSON.parse(localStorage.getItem(MANGANESE_LS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveManganeseItems(items) {
  localStorage.setItem(MANGANESE_LS_KEY, JSON.stringify(items));
}

/**
 * 망간 이력을 chart/card에서 쓸 수 있도록 정규화 (oldest → newest)
 * localStorage 우선, 없으면 data.json fallback
 * @returns {{ date: string, price: number, note: string }[]}
 */
function getManganeseHistory() {
  const stored = getManganeseItems();
  if (stored.length > 0) {
    return stored
      .map(e => ({ date: e.input_date, price: Number(e.price), note: e.note ?? '' }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return appData?.manganese?.history ?? [];
}

// ── 4. Skeleton ────────────────────────────────────────────────────────────────

const ALL_CARD_IDS = [
  'card-exchange-rate',
  'card-lioh', 'card-nickel', 'card-cobalt', 'card-aluminium', 'card-manganese',
];

function showSkeleton() {
  ALL_CARD_IDS.forEach(id => document.getElementById(id)?.classList.add('loading'));
}

function hideSkeleton() {
  ALL_CARD_IDS.forEach(id => document.getElementById(id)?.classList.remove('loading'));
}

// ── 5. 카드 렌더링 ─────────────────────────────────────────────────────────────

/**
 * 변동 배지 업데이트
 * @param {HTMLElement|null} el
 * @param {number} change
 * @param {number} changePct
 * @param {number} dec  소수점 자릿수
 */
function setChangeBadge(el, change, changePct, dec) {
  if (!el) return;

  if (change > 0) {
    el.className = 'change-badge up';
    el.textContent = `▲ +${fmtNum(change, dec)} (+${fmtNum(changePct, 2)}%)`;
  } else if (change < 0) {
    el.className = 'change-badge down';
    // fmtNum에 음수를 넘기면 이미 '-' 포함
    el.textContent = `▼ ${fmtNum(change, dec)} (${fmtNum(changePct, 2)}%)`;
  } else {
    el.className = 'change-badge neutral';
    el.textContent = '변동 없음';
  }
}

/** 환율 카드 */
function renderExchangeCard() {
  const ex = appData.exchange_rate;
  const { rate = 0, change = 0, change_pct = 0, date = '' } = ex.latest ?? {};
  const { current_month = 0, prev_month = 0 }               = ex.monthly_avg ?? {};

  setText('val-rate', fmtNum(rate, 2));
  setChangeBadge(document.getElementById('val-rate-change'), change, change_pct, 2);
  setText('val-rate-date', fmtDisplayDate(date));
  setText('val-rate-avg-cur',  current_month ? fmtNum(current_month, 2) : '--');
  setText('val-rate-avg-prev', prev_month    ? fmtNum(prev_month,    2) : '--');
}

/** 광물 4종 카드 */
function renderMineralCard(key) {
  const m = appData.minerals[key];
  const { price = 0, change = 0, change_pct = 0, date = '' } = m.latest ?? {};
  const { current_month = 0, prev_month = 0 }                = m.monthly_avg ?? {};
  const dec = DECIMALS[key];

  setText(`val-price-${key}`, fmtNum(price, dec));
  setChangeBadge(document.getElementById(`val-change-${key}`), change, change_pct, dec);
  setText(`val-date-${key}`,     fmtDisplayDate(date));
  setText(`val-avg-cur-${key}`,  current_month ? fmtNum(current_month, dec) : '--');
  setText(`val-avg-prev-${key}`, prev_month    ? fmtNum(prev_month,    dec) : '--');
}

/** 망간 카드 — localStorage 우선, 없으면 data.json fallback */
function renderManganeseCard() {
  const stored = getManganeseItems();

  // ── localStorage 데이터 없음 → data.json fallback
  if (stored.length === 0) {
    const mn = appData.manganese;
    const { price = 0, date = '' }             = mn.latest ?? {};
    const { current_month = 0, prev_month = 0} = mn.monthly_avg ?? {};

    setText('val-price-manganese', fmtNum(price, 2));
    const badge = document.getElementById('val-change-manganese');
    if (badge) { badge.className = 'change-badge neutral'; badge.textContent = '--'; }
    setText('val-date-manganese',     fmtDisplayDate(date));
    setText('val-avg-cur-manganese',  current_month ? fmtNum(current_month, 2) : '--');
    setText('val-avg-prev-manganese', prev_month    ? fmtNum(prev_month,    2) : '--');
    return;
  }

  // ── localStorage 데이터 있음 → 최신값 기반 렌더링
  const sorted = [...stored].sort((a, b) => b.input_date.localeCompare(a.input_date));
  const latest = sorted[0];
  const prev   = sorted[1] ?? null;

  const latestPrice = Number(latest.price);
  let change = 0, changePct = 0;
  if (prev) {
    const prevPrice = Number(prev.price);
    change    = latestPrice - prevPrice;
    changePct = prevPrice !== 0 ? (change / prevPrice) * 100 : 0;
  }

  // 당월/전월 평균
  const now  = new Date();
  const curY = now.getFullYear(), curM = now.getMonth();
  const prevM = curM === 0 ? 11 : curM - 1;
  const prevY = curM === 0 ? curY - 1 : curY;

  const vals = (year, month) =>
    stored
      .filter(e => { const d = parseDate(e.input_date); return d.getFullYear() === year && d.getMonth() === month; })
      .map(e => Number(e.price));

  const simpleAvg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const avgCur  = simpleAvg(vals(curY, curM));
  const avgPrev = simpleAvg(vals(prevY, prevM));

  setText('val-price-manganese', fmtNum(latestPrice, 2));
  setChangeBadge(document.getElementById('val-change-manganese'), change, changePct, 2);
  setText('val-date-manganese',     fmtDisplayDate(latest.input_date));
  setText('val-avg-cur-manganese',  avgCur  != null ? fmtNum(avgCur,  2) : '--');
  setText('val-avg-prev-manganese', avgPrev != null ? fmtNum(avgPrev, 2) : '--');
}

// ── 6. 차트 렌더링 ─────────────────────────────────────────────────────────────

/**
 * history 배열(oldest→newest)에서 최근 N일 분량 필터
 */
function sliceByDays(history, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return history.filter(item => parseDate(item.date) >= cutoff);
}

/**
 * Chart.js 라인 차트 생성 (기존 인스턴스 destroy 후 재생성)
 * @param {string} canvasId
 * @param {string[]} labels
 * @param {number[]} values
 * @param {string}   key       LINE_COLORS / DECIMALS 키
 * @param {object}   opts      { pointRadius, spanGaps, notes }
 */
function buildChart(canvasId, labels, values, key, opts = {}) {
  // 기존 인스턴스 제거 (메모리 누수 방지)
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const color = LINE_COLORS[key];
  const dec   = DECIMALS[key];
  const notes = opts.notes ?? [];

  chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data:              values,
        borderColor:       color,
        backgroundColor:   hexToRgba(color, 0.08),
        borderWidth:       2,
        fill:              true,
        tension:           0.35,
        pointRadius:       opts.pointRadius ?? 0,
        pointHoverRadius:  5,
        pointBackgroundColor: color,
        spanGaps:          opts.spanGaps ?? false,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           { duration: 300 },
      interaction:         { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor:     '#334155',
          borderWidth:     1,
          titleColor:      '#94a3b8',
          bodyColor:       '#f1f5f9',
          padding:         10,
          callbacks: {
            title: ctx => ctx[0]?.label ?? '',
            label: ctx => {
              const line = ` ${fmtNum(ctx.raw, dec)}`;
              const note = notes[ctx.dataIndex];
              return note ? `${line}  (${note})` : line;
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { color: '#334155' },
          border: { color: '#334155' },
          ticks:  {
            color:         '#94a3b8',
            maxTicksLimit: 8,
            maxRotation:   0,
            font:          { size: 11 },
          },
        },
        y: {
          grid:   { color: '#334155' },
          border: { color: '#334155' },
          ticks:  {
            color:    '#94a3b8',
            font:     { size: 11 },
            callback: val => fmtNum(val, dec),
          },
        },
      },
    },
  });
}

/** 차트 빈 상태 오버레이 표시 (canvas 숨김 + 안내 문구) */
function showChartEmpty(key) {
  const canvasId = `chart-${key}`;

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  canvas.style.display = 'none';

  const wrap = canvas.parentElement;
  if (!wrap.querySelector('.chart-empty')) {
    const el = document.createElement('div');
    el.className = 'chart-empty';
    el.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;' +
      'justify-content:center;color:#64748b;font-size:0.9rem;';
    el.textContent = '입력된 데이터가 없습니다';
    wrap.appendChild(el);
  }
}

/** 차트 빈 상태 오버레이 제거 (canvas 복원) */
function hideChartEmpty(key) {
  const canvas = document.getElementById(`chart-${key}`);
  if (!canvas) return;
  canvas.style.display = '';
  canvas.parentElement.querySelector('.chart-empty')?.remove();
}

/**
 * 차트 하나를 key + days 기준으로 렌더링
 */
function renderChart(key, days) {
  const canvasId = `chart-${key}`;
  let history, valueKey;
  const opts = {};

  if (key === 'exchange-rate') {
    history  = appData?.exchange_rate?.history ?? [];
    valueKey = 'rate';
  } else if (key === 'manganese') {
    history  = getManganeseHistory();
    valueKey = 'price';
    opts.spanGaps    = true;
    opts.pointRadius = 5;
  } else {
    history  = appData?.minerals?.[key]?.history ?? [];
    valueKey = 'price';
  }

  const sliced = sliceByDays(history, days);

  // 빈 데이터 처리
  if (sliced.length === 0) {
    if (key === 'manganese') {
      showChartEmpty(key);
    } else {
      hideChartEmpty(key);
      buildChart(canvasId, [], [], key);
    }
    return;
  }

  hideChartEmpty(key);

  const labels = sliced.map(item => fmtChartDate(item.date));
  const values = sliced.map(item => item[valueKey]);
  if (key === 'manganese') opts.notes = sliced.map(item => item.note ?? '');

  buildChart(canvasId, labels, values, key, opts);
}

/** 6개 차트 전체 렌더링 */
function renderAllCharts() {
  ALL_CHART_KEYS.forEach(key => renderChart(key, activePeriods[key]));
}

// ── 7. 망간 입력 모달 ─────────────────────────────────────────────────────────

function openModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');

  // 폼 초기화
  document.getElementById('manganese-form').reset();
  const dateInput = document.getElementById('modal-date');
  dateInput.value = todayStr();
  dateInput.max   = todayStr();

  clearFormError();
  renderModalHistory();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('manganese-form').reset();
  clearFormError();
}

/** 모달 이력 테이블 렌더링 (최근 5건, 날짜 내림차순) */
function renderModalHistory() {
  const tbody = document.getElementById('modal-history-tbody');
  if (!tbody) return;

  const items  = getManganeseItems();
  const sorted = [...items]
    .sort((a, b) => b.input_date.localeCompare(a.input_date))
    .slice(0, 5);

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr class="no-data-row"><td colspan="4">이력 없음</td></tr>';
    return;
  }

  tbody.innerHTML = sorted
    .map(item => `
      <tr>
        <td>${escHtml(fmtDisplayDate(item.input_date))}</td>
        <td>${escHtml(fmtNum(Number(item.price), 2))}</td>
        <td>${escHtml(item.note ?? '')}</td>
        <td>
          <button class="btn-delete" data-id="${escHtml(item.id)}">삭제</button>
        </td>
      </tr>`)
    .join('');

  tbody.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => handleModalDelete(btn.dataset.id));
  });
}

function showFormError(msg) {
  let el = document.getElementById('form-error-msg');
  if (!el) {
    el = document.createElement('p');
    el.id = 'form-error-msg';
    el.style.cssText = 'color:#ef4444;font-size:0.8rem;margin-top:8px;grid-column:1/-1;';
    document.querySelector('.form-row').appendChild(el);
  }
  el.textContent = msg;
}

function clearFormError() {
  document.getElementById('form-error-msg')?.remove();
}

/** [저장] 클릭 처리 */
function handleModalSave() {
  clearFormError();

  const dateVal  = document.getElementById('modal-date').value.trim();
  const priceRaw = document.getElementById('modal-price').value.trim();
  const noteVal  = document.getElementById('modal-source').value.trim();
  const priceVal = parseFloat(priceRaw);

  // 유효성 검증
  if (!dateVal)               return showFormError('기준일을 입력해주세요.');
  if (dateVal > todayStr())   return showFormError('미래 날짜는 입력할 수 없습니다.');
  if (!priceRaw || isNaN(priceVal) || priceVal <= 0)
                              return showFormError('가격은 0보다 큰 값을 입력해주세요.');

  const items = getManganeseItems();
  if (items.some(e => e.input_date === dateVal))
    return showFormError('해당 날짜에 이미 입력된 데이터가 있습니다.');

  // 저장
  items.push({
    id:         `mn_${Date.now()}`,
    input_date: dateVal,
    price:      priceVal,
    note:       noteVal || 'KOMIS',
    created_at: new Date().toISOString(),
  });
  saveManganeseItems(items);

  // 카드 & 차트 즉시 갱신
  renderManganeseCard();
  renderChart('manganese', activePeriods['manganese']);

  closeModal();
}

/** [삭제] 클릭 처리 */
function handleModalDelete(id) {
  const items = getManganeseItems().filter(e => e.id !== id);
  saveManganeseItems(items);

  renderModalHistory();
  renderManganeseCard();
  renderChart('manganese', activePeriods['manganese']);
}

// ── 8. 에러 표시 ───────────────────────────────────────────────────────────────

function showFetchError() {
  hideSkeleton();

  let banner = document.getElementById('fetch-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'fetch-error-banner';
    banner.style.cssText =
      'background:#1e293b;border:1px solid #ef4444;border-left:4px solid #ef4444;' +
      'color:#f1f5f9;padding:14px 20px;border-radius:8px;font-size:0.9rem;' +
      'display:flex;align-items:center;gap:10px;';
    banner.innerHTML =
      '<i class="fas fa-circle-exclamation" style="color:#ef4444;flex-shrink:0"></i>' +
      '데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.';
    document.querySelector('.main-content').prepend(banner);
  }
  banner.style.display = 'flex';
}

function hideFetchError() {
  const el = document.getElementById('fetch-error-banner');
  if (el) el.remove();
}

// ── 9. 헤더 업데이트 시각 ─────────────────────────────────────────────────────

function renderLastUpdated() {
  if (!appData?.updated_at) return;
  try {
    const formatted = new Date(appData.updated_at).toLocaleString('ko-KR', {
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
      hour:     '2-digit',
      minute:   '2-digit',
      timeZone: 'Asia/Seoul',
    });
    setText('last-updated', formatted);
  } catch {
    setText('last-updated', appData.updated_at);
  }
}

// ── 10. 데이터 로드 & 전체 렌더링 ─────────────────────────────────────────────

async function loadAndRender() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.classList.add('spinning');

  showSkeleton();
  hideFetchError();

  try {
    const resp = await fetch(`${DATA_URL}?_=${Date.now()}`); // 브라우저 캐시 방지
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    appData = await resp.json();

    // a. 환율 카드
    renderExchangeCard();
    // b. 광물 4종 카드
    MINERAL_KEYS.forEach(key => renderMineralCard(key));
    // c. 망간 카드 (localStorage + data.json 병합)
    renderManganeseCard();
    // d. 그래프 6개 (기본 30일)
    renderAllCharts();
    // e. 헤더 업데이트 시각
    renderLastUpdated();

    hideSkeleton();
  } catch (err) {
    console.error('[Dashboard] data.json fetch 실패:', err);
    showFetchError();
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
}

// ── 11. 이벤트 리스너 ─────────────────────────────────────────────────────────

function setupEventListeners() {

  // 새로고침 버튼
  document.getElementById('refresh-btn')
    .addEventListener('click', loadAndRender);

  // 기간 탭 (이벤트 위임)
  document.querySelectorAll('.period-tabs').forEach(tabGroup => {
    tabGroup.addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;

      const key  = tabGroup.dataset.chart;
      const days = parseInt(tab.dataset.days, 10);

      tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      activePeriods[key] = days;
      renderChart(key, days);
    });
  });

  // 망간 [입력] 버튼
  document.getElementById('manganese-input-btn')
    .addEventListener('click', openModal);

  // 모달 닫기 (× 버튼, 취소 버튼)
  document.getElementById('modal-close-x')
    .addEventListener('click', closeModal);
  document.getElementById('modal-cancel')
    .addEventListener('click', closeModal);

  // 오버레이 배경 클릭으로 닫기
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // 모달 [저장] 버튼
  document.getElementById('modal-save')
    .addEventListener('click', handleModalSave);

  // 폼 내 Enter 키 → 저장
  document.getElementById('manganese-form').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleModalSave(); }
  });

  // ESC 키로 모달 닫기
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('modal-overlay');
      if (!overlay.classList.contains('hidden')) closeModal();
    }
  });

  // 날짜 입력 max = 오늘 (모달 열린 이후에도 날짜 변경에 대응)
  document.getElementById('modal-date').addEventListener('focus', () => {
    document.getElementById('modal-date').max = todayStr();
  });
}

// ── 진입점 ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadAndRender();
});
