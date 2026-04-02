# 一念清涼（A-day-A-Story）— Project Spec

## Project Overview

**一念清涼**是一個面向 50 歲以上華語族群的靜態網站，以佛教經典《百喻經》中 98 則寓言為核心內容，透過 AI 智慧匹配，為正在人生路上咬牙撐著的人——照顧父母的三明治族、被職場推著走的主管、開始問自己「然後呢？」的中年人——推薦最能產生共鳴的故事。

### 專案目標

- 讓千年智慧以親切、口語化的方式陪伴現代人
- 透過 AI 理解使用者的情緒與處境，推薦最適合的寓言故事
- 提供「千年樹洞」AI 對話功能，讓使用者有個安靜傾訴的空間
- 每日自動發文到 Facebook 粉專，持續經營社群

### 成功指標

- 使用者能在 2 步內找到共鳴的故事（輸入心情 → 取得推薦）
- 社群分享率：使用者願意將故事分享給朋友
- 粉專互動：每日自動發文維持穩定觸及

### 線上位址

- 網站：`https://gjj22622.github.io/A-day-A-Story/`
- Facebook 粉專：`https://www.facebook.com/onemomentcool`

---

## Tech Stack

| 層級 | 技術 | 說明 |
|------|------|------|
| 前端 | HTML / CSS / JavaScript（原生） | 無框架 SPA，單一 `index.html` 搭配模組化 JS |
| 字型 | Google Fonts | Noto Serif TC（標題）、Noto Sans TC（內文） |
| AI 引擎 | Google Gemini 2.5 Flash | 故事推薦 + 樹洞對話，透過 REST API 呼叫 |
| 資料庫 | Firebase Realtime Database | 使用者行為追蹤、在線統計、每日計數 |
| 部署 | GitHub Pages | 靜態站，無需後端伺服器 |
| CI/CD | GitHub Actions | 每日自動發文、Token 有效性檢查 |
| 社群 API | Meta Graph API v25.0 | Facebook 粉專自動發文（圖+文） |
| 腳本語言 | Python 3 | 自動發文、產圖、故事頁面生成等工具腳本 |
| Firebase SDK | Firebase JS SDK 10.12.0（compat CDN） | 前端直接載入，不使用 npm |

---

## Project Conventions

### 目錄結構

```
A-day-A-Story/
├── index.html                    # 主頁 SPA（Landing → 心情選擇 → 過場 → 故事顯示）
├── og-image.png                  # Open Graph 預設分享圖
├── css/
│   └── style.css                 # 全站樣式（CSS 變數定義色彩系統）
├── js/
│   ├── app.js                    # 主應用邏輯（畫面切換、AI 匹配、樹洞對話、故事渲染）
│   ├── analytics.js              # Firebase 分析追蹤模組（IIFE: Analytics）
│   └── social.js                 # 社群分享模組（IIFE: Social）
├── data/
│   ├── stories.json              # 98 則故事資料（結構化 JSON，含標籤與關鍵字）
│   ├── keywords.json             # 中文關鍵字 → 情緒/情境/主題標籤對照表
│   ├── content_calendar.json     # FB 發文排程（2026-03-10 ~ 2026-06-15，98 則不重複）
│   ├── post_log.json             # 發文成功/失敗紀錄
│   └── site_content_calendar.json # 網站版發文排程
├── stories/
│   └── BDH-001~098/index.html   # 98 個故事靜態分享頁（OG meta tags + redirect）
├── images/
│   ├── stories/                  # 故事主圖（BDH-XXX.png）
│   ├── custom/                   # 自訂貼文圖片
│   └── README.md
├── scripts/
│   ├── auto_post.py              # FB 自動發文引擎（Meta Graph API）
│   ├── site_auto_post.py         # 網站版自動發文
│   ├── generate_story_pages.py   # 故事分享頁產生器（生成 stories/BDH-XXX/index.html）
│   ├── generate_image.py         # AI 產圖（單張）
│   ├── batch_generate_images.py  # 批次 AI 產圖
│   └── generate_post.py          # 貼文內容產生器
├── dashboard/
│   ├── index.html                # 管理儀表板主頁
│   ├── dashboard.js / .css       # 儀表板前端
│   ├── social.html               # 社群管理頁面
│   └── usage-monitor.html / .js / .css  # API 用量監控
└── .github/workflows/
    ├── auto-post.yml             # 每日 UTC 06:00（台灣 14:00）自動發文
    ├── site-auto-post.yml        # 網站版自動發文
    └── token-check.yml           # FB Token 有效性定期檢查
```

### 命名規範

- **故事 ID**：`BDH-XXX`（三位數字，001~098），BDH = 百喻經（Bǎi Yù Jīng 的近似縮寫）
- **檔案命名**：小寫加底線（snake_case），如 `auto_post.py`、`content_calendar.json`
- **CSS**：使用 CSS 變數定義色彩系統（`--jade`、`--muted`、`--bg` 等）
- **JS 模組**：使用 IIFE 模式封裝（`Analytics`、`Social`），避免全域汙染
- **HTML**：語言設定 `zh-TW`，所有使用者介面文字使用正體中文

### 架構模式

- **前端 SPA**：單頁應用，透過 `showScreen()` 函式切換四個畫面（Landing → Mood → Transition → Story）
- **資料驅動**：故事資料完全存放在 `data/stories.json`，前端啟動時載入
- **AI-first 匹配**：優先使用 Gemini AI 分析使用者輸入並推薦故事，失敗時降級為關鍵字 + 標籤比對
- **靜態分享頁**：每則故事有獨立的 `stories/BDH-XXX/index.html`，用於社群平台爬蟲讀取正確的 OG tags，頁面自動 redirect 回主站

### 版本管理

- CSS/JS 檔案使用 query string 版號（如 `style.css?v=4.0.0`、`app.js?v=4.0.0`）

---

## Domain Context

### 百喻經（Bǎi Yù Jīng）

- 全名《百句譬喻經》，南朝齊（約 492 年）僧伽斯那撰、求那毗地譯
- 原典共 98 則寓言故事（非 100 則），每則以簡短故事闡述佛學道理
- 本專案將每則故事改寫為現代口語版本，保留原典文言文對照

### 故事資料結構

每則故事（`data/stories.json`）包含：

```json
{
  "id": "BDH-001",
  "icon": "🧂",
  "title": "只吃鹽的人",
  "original_title": "愚人食鹽喻",
  "source": "百喻經·卷一",
  "style": "ink",
  "text": ["段落1", "段落2", "..."],
  "moral": "好東西過了頭就變成壞東西。",
  "elaboration": "延伸思考...",
  "reflection": "反思提問...",
  "original_text": "文言文原典...",
  "tags": {
    "emotions": ["exhaustion", "anxiety"],
    "contexts": ["perfectionism", "life_decision"],
    "themes": ["acceptance", "simplicity"]
  },
  "keywords": ["累", "過度", "壓力", "..."]
}
```

### 目標受眾

- **年齡層**：50 歲以上
- **身份**：三明治族、職場主管、退休/準退休族、照顧者
- **情境**：人生轉折、家庭照顧壓力、職場倦怠、自我懷疑
- **語言**：正體中文（台灣用語）

### 情緒標籤系統

`data/keywords.json` 維護中文關鍵字到標準標籤的對照：
- **情緒類**：anxiety、fear、anger、sadness、exhaustion、loneliness、confusion...
- **情境類**：career_failure、relationship_family、life_decision、perfectionism...
- **主題類**：acceptance、letting_go、wisdom_over_knowledge、simplicity...

---

## External Dependencies

### Google Gemini API
- **用途**：故事推薦（AI 匹配）+ 千年樹洞對話
- **模型**：`gemini-2.5-flash`
- **安全機制**：API Key 以 Base64 編碼存放前端，實際安全性靠 Google AI Studio HTTP Referrer 限制（僅允許 `gjj22622.github.io/*`）
- **超時設定**：8 秒
- **降級策略**：AI 匹配失敗時，回退到本地關鍵字 + 標籤比對演算法

### Firebase
- **用途**：使用者行為追蹤（事件記錄、在線狀態、每日統計）
- **服務**：Firebase Realtime Database
- **專案**：`yinian-qingliang`
- **SDK**：Firebase JS SDK 10.12.0（compat mode CDN）

### Meta Graph API
- **用途**：Facebook 粉專自動發文（圖文）
- **版本**：v25.0
- **認證**：長效 Page Access Token（存放於 GitHub Secrets）
- **排程**：每日台灣時間 14:00 由 GitHub Actions 觸發

### GitHub Secrets（CI/CD 所需）
- `FB_PAGE_ID` — Facebook 粉絲專頁 ID
- `FB_PAGE_ACCESS_TOKEN` — 長效 Page Access Token
- `GEMINI_API_KEY` — Google AI Studio API Key（GitHub Actions 中使用）

---

## Important Constraints

### 技術限制
- **純靜態站**：部署在 GitHub Pages，無後端伺服器，所有邏輯在前端或 GitHub Actions 執行
- **API Key 暴露風險**：Gemini API Key 存放在前端 JS（Base64），僅靠 HTTP Referrer 限制保護
- **Firebase 免費額度**：需監控讀寫量，避免超出免費方案限制
- **GitHub Actions 配額**：免費方案每月 2000 分鐘，需控制 workflow 執行頻率

### 內容限制
- 故事總數固定為 98 則（百喻經原典數量）
- 所有內容必須為正體中文
- 語氣必須溫暖、不說教、不雞湯，適合 50+ 歲讀者

### 瀏覽器支援
- 需支援行動裝置（目標受眾主要使用手機）
- 需支援 LINE 內建瀏覽器（台灣使用者最常見的分享入口）

---

## Quality Standards

### 使用者體驗
- 首頁載入後 2 步內可看到故事
- AI 匹配需在 8 秒內回應，超時自動降級
- 所有畫面轉場需有過場動畫，營造寧靜感
- 行動裝置優先設計

### 程式碼
- JS 模組使用 IIFE 封裝，避免全域變數汙染
- 所有使用者可見文字使用正體中文
- 錯誤處理需提供友善的中文提示訊息
- Firebase 事件追蹤需涵蓋關鍵使用者行為

### 社群發文
- 每日準時發文（台灣 14:00）
- 發文失敗需記錄在 `post_log.json` 並支援重試
- Token 有效性需定期檢查

---

## Getting Started

### 本機開發

```bash
# 1. Clone 專案
git clone https://github.com/gjj22622/A-day-A-Story.git
cd A-day-A-Story

# 2. 啟動本機伺服器（需要 HTTP server，不能直接開 file://）
python -m http.server 8080

# 3. 開啟瀏覽器
open http://localhost:8080
```

### 生成故事分享頁

```bash
# 生成全部 98 則故事的靜態分享頁
python scripts/generate_story_pages.py

# 指定特定故事
python scripts/generate_story_pages.py --ids BDH-001 BDH-002
```

### 手動觸發 FB 發文

```bash
# 乾跑模式（不實際發文）
python scripts/auto_post.py --dry-run

# 指定日期發文
python scripts/auto_post.py --date 2026-03-15

# 檢查 Token 狀態
python scripts/auto_post.py --check-token
```

### 環境變數（本機測試自動發文時需要）

```
FB_PAGE_ID=<Facebook 粉絲專頁 ID>
FB_PAGE_ACCESS_TOKEN=<長效 Page Access Token>
GEMINI_API_KEY=<Google AI Studio API Key>
```
