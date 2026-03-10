#!/usr/bin/env python3
"""
一念清涼 — 網站相關帶狀貼文自動發文引擎
每週 2-4 篇，晚上 22:00 台灣時間發佈

三大子類：
1. feature_tutorial — 功能教學
2. dashboard_insight — Dashboard 匿名數據洞察
3. release_note — 改版通知

使用方式：
  python site_auto_post.py                    # 正式發文
  python site_auto_post.py --dry-run          # 乾跑模式
  python site_auto_post.py --date 2026-03-12  # 指定日期
"""

import json
import os
import sys
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# 匯入共用的 FB 發文函數
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from auto_post import fb_post, load_json, save_json, _multipart_encode

GRAPH_API_VERSION = "v25.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

SITE_CALENDAR_PATH = "data/site_content_calendar.json"
POST_LOG_PATH = "data/post_log.json"

TW_TZ = timezone(timedelta(hours=8))

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_TEXT_MODEL = "gemini-2.5-flash"
GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"


def generate_site_post_text(post_entry, api_key):
    """用 Gemini 為網站相關貼文生成文案"""
    if not api_key:
        return None

    category_prompts = {
        "feature_tutorial": """你是「一念清涼」Facebook 粉專小編。
請為以下網站功能寫一篇教學貼文，讓讀者想馬上去試試看。

功能名稱：{title}
功能描述：{description}
網站連結：https://gjj22622.github.io/A-day-A-Story/

寫作要求：
- 繁體中文，台灣口語
- 用場景帶入：先描述一個使用者可能的心情/情境，再自然地介紹這個功能
- 不要像說明書，要像朋友在推薦一個好東西
- 斷句規則：每行不超過 20 字，標點符號後換行，驚喜點前換行，金句獨立一行
- 長度 8-12 行（不含 hashtag）
- emoji 最多 3 個
- 最後自然帶出網站連結
- 不要加 hashtag（我會自己加）""",

        "dashboard_insight": """你是「一念清涼」Facebook 粉專小編。
請根據以下主題，寫一篇「匿名數據洞察」貼文。
這類貼文把 Dashboard 上的匿名行為數據，轉化成有趣的觀察分享給讀者。

主題：{title}
描述：{description}

寫作要求：
- 繁體中文，台灣口語
- 數據要匿名化，不能有任何個人辨識資訊
- 語氣帶點驚喜感：「你知道嗎？」「猜猜看」「結果出乎意料」
- 用具體數字或比例增加說服力（可以合理推估）
- 斷句規則：每行不超過 20 字，標點符號後換行，驚喜點前換行
- 長度 8-12 行
- emoji 最多 3 個
- 不要加 hashtag""",

        "release_note": """你是「一念清涼」Facebook 粉專小編。
請寫一篇改版通知貼文，告訴讀者網站有了什麼新功能或改善。

改版內容：{title}
說明：{description}

寫作要求：
- 繁體中文，台灣口語
- 不要像工程師寫 changelog，要像朋友說「欸我跟你說一個好消息」
- 斷句規則：每行不超過 20 字，標點符號後換行
- 長度 6-10 行
- emoji 最多 3 個
- 不要加 hashtag"""
    }

    category = post_entry.get("category", "feature_tutorial")
    prompt_template = category_prompts.get(category, category_prompts["feature_tutorial"])
    prompt = prompt_template.format(
        title=post_entry["title"],
        description=post_entry["description"]
    )

    url = f"{GEMINI_API_URL}/{GEMINI_TEXT_MODEL}:generateContent?key={api_key}"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.9, "maxOutputTokens": 1024}
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            text = result["candidates"][0]["content"]["parts"][0]["text"].strip()
            return text
    except Exception as e:
        print(f"⚠️ Gemini 文案生成失敗：{e}")
        return None


def generate_site_post_image(post_entry, api_key):
    """用 Gemini 為網站相關貼文生成圖片"""
    if not api_key:
        return None

    import base64

    category_styles = {
        "feature_tutorial": "A warm, inviting illustration showing a person discovering a peaceful digital experience on their phone. Soft lotus elements, warm gold glow from screen.",
        "dashboard_insight": "An abstract, artistic data visualization with flowing organic shapes. Buddhist-inspired patterns emerging from gentle data streams. Contemplative mood.",
        "release_note": "A blooming lotus flower with subtle digital/tech elements woven in. Representing growth and new beginnings. Fresh and hopeful mood.",
    }

    category = post_entry.get("category", "feature_tutorial")
    style_desc = category_styles.get(category, category_styles["feature_tutorial"])

    prompt = f"""{style_desc}

Theme: {post_entry['title']}
Color palette: Deep indigo blues (#0D1B2A), warm gold/amber (#D4A574), jade green (#2A6B5E)
Style: Warm, modern, minimal illustration with Buddhist aesthetics
NO text, NO words, NO letters anywhere in the image
Square format (1:1)"""

    url = f"{GEMINI_API_URL}/{GEMINI_IMAGE_MODEL}:generateContent?key={api_key}"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["image", "text"], "temperature": 0.8}
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            for part in result["candidates"][0]["content"]["parts"]:
                if "inlineData" in part:
                    img_data = base64.b64decode(part["inlineData"]["data"])
                    mime = part["inlineData"]["mimeType"]
                    ext = "png" if "png" in mime else "jpg"
                    path = f"images/custom/{post_entry['post_id']}.{ext}"
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    with open(path, "wb") as f:
                        f.write(img_data)
                    print(f"🖼️ 圖片生成：{path} ({len(img_data)//1024} KB)")
                    return path
    except Exception as e:
        print(f"⚠️ 圖片生成失敗：{e}")
    return None


# Hashtag 設定
SITE_HASHTAGS_CORE = ["#一念清涼", "#百喻經"]
SITE_HASHTAGS_POOL = [
    "#佛學智慧", "#心靈成長", "#網站推薦", "#療癒系",
    "#寓言故事", "#靜心", "#正念", "#數位體驗",
    "#古老智慧", "#現代寓言", "#mindfulness",
]

import random

def _pick_site_hashtags():
    extras = random.sample(SITE_HASHTAGS_POOL, random.randint(3, 4))
    return " ".join(SITE_HASHTAGS_CORE + extras)


def main():
    parser = argparse.ArgumentParser(description='一念清涼 網站帶狀貼文引擎')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--date', type=str)
    args = parser.parse_args()

    page_id = os.environ.get('FB_PAGE_ID', '')
    access_token = os.environ.get('FB_PAGE_ACCESS_TOKEN', '')
    gemini_key = os.environ.get('GEMINI_API_KEY', '')

    # 載入排程
    calendar = load_json(SITE_CALENDAR_PATH)
    if not calendar:
        print("❌ 找不到 site_content_calendar.json")
        sys.exit(1)

    target_date = args.date or datetime.now(TW_TZ).strftime('%Y-%m-%d')

    # 找今天的貼文
    today_post = None
    for post in calendar['posts']:
        if post['date'] == target_date:
            today_post = post
            break

    if not today_post:
        print(f"📅 {target_date}：今天沒有網站相關貼文")
        sys.exit(0)

    # 冪等檢查
    post_log = load_json(POST_LOG_PATH) or []
    for log in post_log:
        if log.get('story_id') == today_post['post_id'] and log.get('status') == 'success':
            print(f"✅ {today_post['post_id']} 已發過，跳過")
            sys.exit(0)

    print(f"📅 {target_date}")
    print(f"📌 {today_post['title']} [{today_post['category']}]")

    # 生成文案
    post_text = generate_site_post_text(today_post, gemini_key)
    if not post_text:
        print("❌ 文案生成失敗")
        sys.exit(1)

    # 組裝完整貼文
    hashtags = _pick_site_hashtags()
    link = "https://gjj22622.github.io/A-day-A-Story/"
    full_message = f"{post_text}\n\n🔗 {link}\n\n{hashtags}"

    print(f"\n{'─'*50}")
    print(f"【貼文預覽】")
    print(full_message[:500])
    print(f"{'─'*50}")

    # 生成圖片
    image_path = generate_site_post_image(today_post, gemini_key)

    if args.dry_run:
        print("\n🧪 乾跑模式")
        sys.exit(0)

    if not page_id or not access_token:
        print("❌ 未設定 FB 環境變數")
        sys.exit(1)

    # 發文
    try:
        post_id = fb_post(page_id, access_token, full_message,
                          link=link if not image_path else None,
                          image_path=image_path)
        print(f"✅ 發文成功！Post ID: {post_id}")

        post_log.append({
            "date": target_date,
            "story_id": today_post['post_id'],
            "story_title": today_post['title'],
            "platform": "facebook",
            "category": today_post['category'],
            "series": "site_posts",
            "status": "success",
            "post_id": post_id,
            "timestamp": datetime.now(TW_TZ).isoformat(),
        })
        save_json(POST_LOG_PATH, post_log)

        # 標記已發佈
        today_post['status'] = 'posted'
        save_json(SITE_CALENDAR_PATH, calendar)

    except Exception as e:
        print(f"❌ 發文失敗：{e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
