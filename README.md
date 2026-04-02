# 양극소재 원가 모니터링 대시보드

환율(USD/KRW)과 LME 양극소재 핵심 광물 5종(수산화리튬·니켈·코발트·알루미늄·망간)의 가격을 매일 자동으로 수집하여 시각화하는 웹 대시보드입니다.

**대시보드 URL:** `https://[계정명].github.io/[저장소명]`

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 자동 수집 | 매일 09:00 KST GitHub Actions로 환율·LME 광물가 수집 |
| 가격 카드 | 현재가·변동폭·변동률(▲빨강/▼파랑)·당월·전월 평균 |
| 인터랙티브 차트 | 6종 × 5개 기간 탭 (7일·30일·90일·180일·365일) |
| 망간 수동 입력 | 담당자가 직접 입력, 브라우저 localStorage에 저장 |
| 반응형 레이아웃 | 데스크톱(5열) → 태블릿(3열/2열) → 모바일(1열) |

---

## 로컬 실행 방법

```bash
# 1. 저장소 클론
git clone https://github.com/[계정명]/[저장소명].git
cd [저장소명]

# 2. 의존 패키지 설치
pip install -r requirements.txt

# 3. 초기 더미 데이터 생성 (최초 1회만 실행)
python generate_dummy.py

# 4. 브라우저에서 index.html 열기
#    (로컬 파일 접근 CORS 문제가 있으면 아래 간이 서버 사용)
python -m http.server 8000
# → http://localhost:8000 접속
```

> **참고:** `generate_dummy.py`는 `data.json`이 이미 있어도 덮어씁니다.  
> 실제 수집 데이터가 있는 상태라면 실행하지 마세요.

---

## 가격 수동 수집 (fetch_prices.py)

```bash
python fetch_prices.py
```

- 환율은 ExchangeRate-API에서 자동 수집됩니다.
- LME 4종은 공식 사이트 파싱을 시도하며, 차단(403) 시 기존값을 유지합니다.
- 수집 결과는 콘솔에 요약 출력됩니다:

```
수집 완료: 환율 ✅ | LiOH ❌ | 니켈 ❌ | 코발트 ✅ | 알루미늄 ✅
```

> **LME 403 안내:** LME 공식 사이트는 봇 접근을 차단합니다.  
> 지속적으로 실패하면 `fetch_prices.py`의 `fetch_lme_price()` 함수를  
> LME 데이터 API 또는 별도 데이터 공급원으로 교체하세요.

---

## 망간 가격 입력 방법

망간 가격(KOMIS 주 1회 고시)은 담당자가 수동으로 입력합니다.

1. 대시보드 우상단 망간 카드의 **[✏ 입력]** 버튼 클릭
2. 기준일·가격(USD/dmtu)·출처 입력 후 **[저장]**
3. 카드와 그래프가 즉시 업데이트됩니다
4. 입력 이력은 브라우저 `localStorage`에 저장되며, 모달 하단에서 삭제 가능

> 입력 데이터는 해당 브라우저에만 저장됩니다.  
> 공유가 필요하면 `fetch_prices.py`에 KOMIS API 연동을 추가하거나,  
> 망간 데이터를 `data.json`에 직접 커밋하세요.

---

## 데이터 소스

| 항목 | 소스 | 방식 | 주기 |
|------|------|------|------|
| 환율 (USD/KRW) | [ExchangeRate-API](https://open.er-api.com) (무료, 인증 불필요) | REST API | 매일 |
| 수산화리튬 | LME 공식 웹사이트 파싱 | HTML 스크래핑 | 매일 |
| 니켈 | LME 공식 웹사이트 파싱 | HTML 스크래핑 | 매일 |
| 코발트 | LME 공식 웹사이트 파싱 | HTML 스크래핑 | 매일 |
| 알루미늄 | LME 공식 웹사이트 파싱 | HTML 스크래핑 | 매일 |
| 망간 | 담당자 수동 입력 (KOMIS 참고) | localStorage | 주 1회 |

---

## 파일 구조

```
.
├── index.html              # 대시보드 단일 페이지
├── styles.css              # 다크 테마 스타일 (반응형)
├── script.js               # 데이터 fetch·카드·차트·모달 로직
├── data.json               # 가격 이력 데이터 (GitHub Actions가 매일 업데이트)
├── fetch_prices.py         # 가격 수집 스크립트 (Actions에서 실행)
├── generate_dummy.py       # 초기 더미 데이터 생성 (최초 1회)
├── requirements.txt        # Python 의존 패키지
└── .github/
    └── workflows/
        └── update_prices.yml   # 매일 자동 실행 워크플로우
```

---

## GitHub 배포 순서

### 1단계 — Repository 생성 및 파일 업로드

1. GitHub에서 **New repository** 클릭 → 이름 입력 → **Public** 선택 → Create
2. 위 파일 구조 그대로 업로드 (`.github/workflows/` 폴더 포함)

```bash
git init
git remote add origin https://github.com/[계정명]/[저장소명].git
git add .
git commit -m "init: 양극소재 원가 모니터링 대시보드"
git push -u origin main
```

### 2단계 — GitHub Pages 설정

1. 저장소 상단 **Settings** 탭 클릭
2. 좌측 메뉴 **Pages** 선택
3. **Source** → **GitHub Actions** 선택
4. 아래 워크플로우 파일을 추가로 생성:

`.github/workflows/pages.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_run:
    workflows: ["Update Prices"]
    types: [completed]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 3단계 — 최초 실행 및 동작 확인

1. **Actions 탭** → **Update Prices** 워크플로우 선택
2. **Run workflow** 클릭 → 수동 실행으로 최초 `data.json` 업데이트 확인
3. 이후 **매일 09:00 KST** 자동 실행 (`cron: "0 0 * * *"`)

---

## GitHub Actions 워크플로우 상세

```
트리거:  매일 00:00 UTC (= 09:00 KST) + 수동 실행(workflow_dispatch)
권한:    contents: write  ← data.json 커밋을 위해 필요
환경:    ubuntu-latest, Python 3.11

실행 순서:
  1. actions/checkout@v4
  2. actions/setup-python@v5 (3.11)
  3. pip install -r requirements.txt
  4. python fetch_prices.py
  5. git diff --cached --quiet 확인
     → 변경 있으면: git commit "chore: update prices YYYY-MM-DD" + push
     → 변경 없으면: 스킵
```

---

## 개발 환경

- Python 3.9+
- 브라우저: Chrome / Edge / Firefox (최신 버전)
- 외부 의존:
  - [Chart.js](https://www.chartjs.org/) (CDN)
  - [Font Awesome 6](https://fontawesome.com/) (CDN)
  - [ExchangeRate-API](https://www.exchangerate-api.com/) (무료)
