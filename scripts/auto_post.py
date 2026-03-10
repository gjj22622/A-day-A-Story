#!/usr/bin/env python3
"""
一念清涼 — Facebook 全自動發文引擎
從 content_calendar.json 讀取今日排程，透過 Meta Graph API 發文到 FB 粉專

使用方式：
  python auto_post.py                    # 正式發文
  python auto_post.py --dry-run          # 乾跑模式（不實際發文）
  python auto_post.py --date 2026-03-15  # 指定日期發文（測試用）
  python auto_post.py --check-token      # 檢查 Token 狀態

環境變數（存在 GitHub Secrets）：
  FB_PAGE_ID          — Facebook 粉絲專頁 ID
  FB_PAGE_ACCESS_TOKEN — 長效 Page Access Token
  NOTIFICATION_EMAIL   — 發文失敗通知信箱（選用）
"""

import json
import os
import sys
import argparse
import urllib.request
import urllib.parse
import urllib.error
import mimetypes
import uuid
from datetime import datetime, timezone, timedelta

# ─────────────────────────────────────────────
# 配置
# ─────────────────────────────────────────────

GRAPH_API_VERSION = "v25.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

# 檔案路徑（相對於 repo 根目錄）
CALENDAR_PATH = "data/content_calendar.json"
STORIES_PATH = "data/stories.json"
POST_LOG_PATH = "data/post_log.json"
IMAGES_DIR = "images/stories"
CUSTOM_POST_PATH = "data/custom_post.json"  # 自訂貼文（存在即觸發）

# 台灣時區 UTC+8
TW_TZ = timezone(timedelta(hours=8))


# ─────────────────────────────────────────────
# Graph API 操作
# ─────────────────────────────────────────────

def _multipart_encode(fields, files):
    """
    手動建立 multipart/form-data 請求體
    fields: dict of {name: value}
    files: list of (name, filename, content_bytes, content_type)
    回傳 (body_bytes, content_type_header)
    """
    boundary = f"----FormBoundary{uuid.uuid4().hex}"
    body = bytearray()

    for key, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        body += f"{value}\r\n".encode()

    for name, filename, content, content_type in files:
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
        body += f"Content-Type: {content_type}\r\n\r\n".encode()
        body += content
        body += b"\r\n"

    body += f"--{boundary}--\r\n".encode()
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def fb_post(page_id, access_token, message, link=None, image_path=None):
    """
    透過 Graph API 發文到 Facebook 粉專
    如有 image_path，使用 /{page_id}/photos（圖文貼文）
    否則使用 /{page_id}/feed（純文字貼文）
    回傳 post_id 或拋出例外
    """

    # ─── 有圖片：用 /photos 端點 ───
    if image_path and os.path.exists(image_path):
        url = f"{GRAPH_API_BASE}/{page_id}/photos"

        mime_type = mimetypes.guess_type(image_path)[0] or 'image/png'
        filename = os.path.basename(image_path)

        with open(image_path, 'rb') as f:
            image_data = f.read()

        fields = {
            "message": message,
            "access_token": access_token,
        }
        files = [("source", filename, image_data, mime_type)]

        body, content_type = _multipart_encode(fields, files)
        req = urllib.request.Request(url, data=body, method='POST', headers={
            'Content-Type': content_type,
        })

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                return result.get('post_id') or result.get('id')
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            raise Exception(f"FB Photos API Error {e.code}: {error_body}")

    # ─── 無圖片：用 /feed 端點 ───
    url = f"{GRAPH_API_BASE}/{page_id}/feed"
    data = {
        "message": message,
        "access_token": access_token,
    }
    if link:
        data["link"] = link

    encoded = urllib.parse.urlencode(data).encode('utf-8')
    req = urllib.request.Request(url, data=encoded, method='POST')

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            return result.get('id')
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise Exception(f"FB API Error {e.code}: {error_body}")


def check_token(access_token):
    """
    檢查 Page Access Token 的狀態和到期時間
    """
    url = f"{GRAPH_API_BASE}/debug_token?input_token={access_token}&access_token={access_token}"
    req = urllib.request.Request(url)

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            data = result.get('data', {})
            is_valid = data.get('is_valid', False)
            expires_at = data.get('expires_at', 0)

            if expires_at == 0:
                expiry_str = "永不過期（長效 Token）"
                days_left = 999
            else:
                expiry = datetime.fromtimestamp(expires_at, tz=TW_TZ)
                days_left = (expiry - datetime.now(TW_TZ)).days
                expiry_str = f"{expiry.strftime('%Y-%m-%d %H:%M')} TW ({days_left} 天後)"

            return {
                "is_valid": is_valid,
                "expires_at": expiry_str,
                "days_left": days_left,
                "scopes": data.get('scopes', []),
                "type": data.get('type', 'unknown'),
            }
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        return {"is_valid": False, "error": error_body}


def extend_token(app_id, app_secret, short_token):
    """
    將短期 Token 延展為長效 Token（60 天）
    """
    url = (
        f"{GRAPH_API_BASE}/oauth/access_token"
        f"?grant_type=fb_exchange_token"
        f"&client_id={app_id}"
        f"&client_secret={app_secret}"
        f"&fb_exchange_token={short_token}"
    )
    req = urllib.request.Request(url)

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            return result.get('access_token')
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise Exception(f"Token 延展失敗: {error_body}")


# ─────────────────────────────────────────────
# 核心邏輯
# ─────────────────────────────────────────────

def load_json(path):
    """載入 JSON 檔案"""
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    """儲存 JSON 檔案"""
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_today_entry(calendar, target_date=None):
    """
    從排程日曆中找出今天的貼文
    """
    if target_date is None:
        today = datetime.now(TW_TZ).strftime('%Y-%m-%d')
    else:
        today = target_date

    for entry in calendar.get('calendar', []):
        if entry['date'] == today:
            return entry
    return None


def is_already_posted(post_log, date_str):
    """
    冪等保護：檢查今天是否已經發過文
    """
    for log in post_log:
        if log.get('date') == date_str and log.get('status') == 'success':
            return True
    return False


def get_story_content(stories, story_id, platform='facebook'):
    """
    從 stories.json 取得指定故事的社群文案
    """
    for story in stories:
        if story['id'] == story_id:
            return {
                'message': story['social'].get(platform, ''),
                'title': story['title'],
                'icon': story['icon'],
                'link': f"https://gjj22622.github.io/A-day-A-Story/?story={story_id}"
            }
    return None


def log_post(post_log_path, entry, result):
    """
    記錄發文結果到 post_log.json
    """
    log = load_json(post_log_path) or []
    log.append({
        "date": entry['date'],
        "story_id": entry['story_id'],
        "story_title": entry['story_title'],
        "platform": entry['platform'],
        "theme_week": entry.get('theme', ''),
        "status": result['status'],
        "post_id": result.get('post_id'),
        "error": result.get('error'),
        "timestamp": datetime.now(TW_TZ).isoformat(),
    })
    save_json(post_log_path, log)


# ─────────────────────────────────────────────
# 主程式
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='一念清涼 Facebook 自動發文引擎')
    parser.add_argument('--dry-run', action='store_true', help='乾跑模式，不實際發文')
    parser.add_argument('--date', type=str, help='指定發文日期 (YYYY-MM-DD)')
    parser.add_argument('--check-token', action='store_true', help='檢查 Token 狀態')
    args = parser.parse_args()

    # 環境變數
    page_id = os.environ.get('FB_PAGE_ID', '')
    access_token = os.environ.get('FB_PAGE_ACCESS_TOKEN', '')

    # ─── 檢查 Token 模式 ───
    if args.check_token:
        if not access_token:
            print("❌ 未設定 FB_PAGE_ACCESS_TOKEN 環境變數")
            sys.exit(1)
        info = check_token(access_token)
        print("🔑 Token 狀態：")
        for k, v in info.items():
            print(f"   {k}: {v}")
        if info.get('days_left', 0) < 15 and info.get('days_left', 0) != 999:
            print("⚠️ Token 即將到期，請儘快延展！")
            sys.exit(2)
        sys.exit(0)

    # ─── 檢查自訂貼文 ───
    custom_post = load_json(CUSTOM_POST_PATH)
    if custom_post:
        print("📌 偵測到自訂貼文 (custom_post.json)")
        print(f"📝 主題：{custom_post.get('title', '自訂貼文')}")
        print(f"🏷️ 類型：{custom_post.get('category', 'custom')}")

        content = {
            'message': custom_post['message'],
            'title': custom_post.get('title', '自訂貼文'),
            'icon': custom_post.get('icon', '📌'),
            'link': custom_post.get('link'),
        }
        image_path = custom_post.get('image_path')
        if image_path and not os.path.exists(image_path):
            print(f"⚠️ 指定圖片不存在：{image_path}")
            image_path = None
        is_dynamic = False

        # 用自訂貼文的 entry 格式
        target_date = datetime.now(TW_TZ).strftime('%Y-%m-%d')
        entry = {
            'date': target_date,
            'story_id': custom_post.get('post_id', 'CUSTOM'),
            'story_title': custom_post.get('title', '自訂貼文'),
            'platform': 'facebook',
        }

        print(f"\n📌 自訂貼文")
        print(f"{'─'*50}")
        print(f"【貼文預覽】")
        print(content['message'][:500] + '...' if len(content['message']) > 500 else content['message'])
        print(f"{'─'*50}")
        if image_path:
            print(f"🖼️ 圖片：{image_path}")

        # ─── 乾跑模式 ───
        if args.dry_run:
            print("\n🧪 乾跑模式：不會實際發文")
            sys.exit(0)

        # ─── 正式發文 ───
        if not page_id or not access_token:
            print("❌ 未設定 FB_PAGE_ID 或 FB_PAGE_ACCESS_TOKEN")
            sys.exit(1)

        try:
            post_type = "圖文" if image_path else "純文字"
            print(f"\n📤 {post_type}發文中...")
            post_id = fb_post(
                page_id=page_id,
                access_token=access_token,
                message=content['message'],
                link=content.get('link') if not image_path else None,
                image_path=image_path,
            )
            print(f"✅ 自訂貼文發文成功！Post ID: {post_id}")

            # 記錄到 log
            post_log = load_json(POST_LOG_PATH) or []
            post_log.append({
                "date": target_date,
                "story_id": entry['story_id'],
                "story_title": entry['story_title'],
                "platform": "facebook",
                "category": custom_post.get('category', 'custom'),
                "status": "success",
                "post_id": post_id,
                "timestamp": datetime.now(TW_TZ).isoformat(),
            })
            save_json(POST_LOG_PATH, post_log)

            # 消費掉 custom_post.json（改名為已完成）
            done_path = CUSTOM_POST_PATH.replace('.json', f'_done_{target_date}.json')
            os.rename(CUSTOM_POST_PATH, done_path)
            print(f"📦 custom_post.json → {done_path}")

        except Exception as e:
            print(f"❌ 自訂貼文發文失敗：{e}")
            sys.exit(1)

        sys.exit(0)

    # ─── 載入資料（一般故事排程） ───
    calendar = load_json(CALENDAR_PATH)
    if not calendar:
        print("❌ 找不到 content_calendar.json")
        sys.exit(1)

    stories = load_json(STORIES_PATH)
    if not stories:
        print("❌ 找不到 stories.json")
        sys.exit(1)

    post_log = load_json(POST_LOG_PATH) or []

    # ─── 找今日排程 ───
    target_date = args.date or datetime.now(TW_TZ).strftime('%Y-%m-%d')
    entry = get_today_entry(calendar, target_date)

    if not entry:
        print(f"📅 {target_date}：今天沒有排程貼文")
        sys.exit(0)

    print(f"📅 {target_date} ({entry['weekday']})")
    print(f"📖 {entry['story_icon']} {entry['story_title']} ({entry['story_id']})")
    print(f"🏷️ 主題週：{entry.get('theme', 'N/A')}")

    # ─── 冪等檢查 ───
    if is_already_posted(post_log, target_date):
        print("✅ 今天已經發過文了，跳過（冪等保護）")
        sys.exit(0)

    # ─── 取得文案（動態生成優先） ───
    gemini_key = os.environ.get('GEMINI_API_KEY', '')

    # 動態匯入 generate_post 模組
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    # 找到完整故事資料
    story_obj = next((s for s in stories if s['id'] == entry['story_id']), None)

    content = None
    is_dynamic = False

    if story_obj:
        try:
            from generate_post import get_post_content
            post_result = get_post_content(story_obj, api_key=gemini_key)
            if post_result:
                content = {
                    'message': post_result['message'],
                    'title': story_obj['title'],
                    'icon': story_obj['icon'],
                    'link': f"https://gjj22622.github.io/A-day-A-Story/?story={entry['story_id']}"
                }
                is_dynamic = post_result['is_dynamic']
        except Exception as e:
            print(f"⚠️ 動態文案產生失敗，降級使用靜態文案：{e}")

    # 降級：使用靜態文案
    if not content or not content.get('message'):
        content = get_story_content(stories, entry['story_id'], entry['platform'])

    if not content or not content['message']:
        print(f"❌ 找不到 {entry['story_id']} 的 {entry['platform']} 文案")
        sys.exit(1)

    mode_label = "🤖 動態生成" if is_dynamic else "📋 靜態文案"
    print(f"\n{mode_label}")
    print(f"{'─'*50}")
    print(f"【貼文預覽】")
    print(content['message'][:500] + '...' if len(content['message']) > 500 else content['message'])
    print(f"{'─'*50}")

    # ─── 準備圖片 ───
    image_path = None

    # 動態匯入 generate_image 模組
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from generate_image import ensure_image
        image_path = ensure_image(
            story_id=entry['story_id'],
            stories=stories,
            api_key=gemini_key,
            force=False
        )
        if image_path:
            print(f"🖼️ 圖片就緒：{image_path}")
    except Exception as e:
        print(f"⚠️ 圖片產生失敗，將以純文字發文：{e}")
        image_path = None

    # ─── 乾跑模式 ───
    if args.dry_run:
        print("\n🧪 乾跑模式：不會實際發文")
        result = {
            "status": "dry_run",
            "post_id": None,
            "has_image": image_path is not None,
            "is_dynamic_post": is_dynamic,
        }
        log_post(POST_LOG_PATH, entry, result)
        print("✅ 乾跑完成，已記錄到 post_log.json")
        sys.exit(0)

    # ─── 正式發文 ───
    if not page_id or not access_token:
        print("❌ 未設定 FB_PAGE_ID 或 FB_PAGE_ACCESS_TOKEN")
        print("   請在 GitHub Secrets 中設定這兩個環境變數")
        sys.exit(1)

    # 嘗試發文（含重試）
    max_retries = 2
    for attempt in range(max_retries):
        try:
            post_type = "圖文" if image_path else "純文字"
            print(f"\n📤 {post_type}發文中... (嘗試 {attempt + 1}/{max_retries})")
            post_id = fb_post(
                page_id=page_id,
                access_token=access_token,
                message=content['message'],
                link=content['link'] if not image_path else None,
                image_path=image_path,
            )
            print(f"✅ 發文成功！Post ID: {post_id}")

            result = {
                "status": "success",
                "post_id": post_id,
                "has_image": image_path is not None,
                "is_dynamic_post": is_dynamic,
            }
            log_post(POST_LOG_PATH, entry, result)

            # 更新排程狀態
            for cal_entry in calendar['calendar']:
                if cal_entry['date'] == target_date:
                    cal_entry['status'] = 'posted'
                    break
            save_json(CALENDAR_PATH, calendar)

            sys.exit(0)

        except Exception as e:
            print(f"❌ 發文失敗：{e}")
            if attempt < max_retries - 1:
                print("   5 秒後重試...")
                import time
                time.sleep(5)

    # 所有重試都失敗
    print("\n❌ 所有重試都失敗")
    result = {
        "status": "failed",
        "error": str(e),
    }
    log_post(POST_LOG_PATH, entry, result)
    sys.exit(1)


if __name__ == '__main__':
    main()
