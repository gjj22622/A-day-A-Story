# 一念清涼 — 故事圖片資料夾

## 命名規則

```
images/stories/{story_id}.{png|jpg|webp}
```

範例：
- `BDH-001.png` ← 只吃鹽的人
- `BDH-002.jpg` ← 用牛奶灌甘蔗
- `BDH-098.webp` ← 第98則故事

## 圖片優先順序

auto_post.py 發文時會依此順序尋找圖片：

1. **手動上傳** — 檢查 `images/stories/BDH-XXX.{png,jpg,webp}` 是否存在
2. **Gemini 自動產圖** — 若無手動圖，用 Gemini API 根據故事內容產生插圖

手動上傳的圖片永遠優先於 AI 產圖。

## 圖片規格建議

- **尺寸**：1200×1200 px（FB 建議正方形）或 1200×630 px（橫式）
- **格式**：PNG 或 JPG（FB 支援 PNG、JPG、GIF、WEBP）
- **檔案大小**：< 4MB
- **風格**：暖色調、禪意、水墨或插畫風格，避免出現文字

## 如何手動新增圖片

1. 將圖片命名為 `{story_id}.png`（例：`BDH-015.png`）
2. 放入 `images/stories/` 資料夾
3. Commit & Push 到 GitHub
4. 下次該故事發文時會自動使用此圖片
