#!/usr/bin/env python3
"""
一念清涼 — 故事圖片產生器
檢查手動上傳圖 → 無則用 Gemini API 自動產圖

使用方式：
  python generate_image.py BDH-001           # 產出指定故事圖片
  python generate_image.py BDH-001 --force   # 強制重新產圖（忽略已存在的圖）

環境變數：
  GEMINI_API_KEY — Google AI Studio API Key
"""

import json
import os
import sys
import glob
import argparse
import base64
import urllib.request
import urllib.error

# ─────────────────────────────────────────────
# 配置
# ─────────────────────────────────────────────

STORIES_PATH = "data/stories.json"
IMAGES_DIR = "images/stories"
SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

# Gemini API
GEMINI_MODEL = "gemini-2.5-flash-preview-05-20"
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# 圖片風格指引（品牌一致性）
STYLE_GUIDE = """
Style: Warm, contemplative digital illustration with soft lighting.
Atmosphere: Serene, meditative, slightly dreamlike.
Color palette: Deep indigo blues, warm gold/amber tones, jade green accents,
soft cream highlights. Inspired by moonlit Buddhist temple aesthetics.
Art style: Modern watercolor-meets-digital illustration,
reminiscent of Studio Ghibli's gentler moments.
NO text, NO words, NO letters in the image.
Aspect ratio: Square (1:1).
"""


# ─────────────────────────────────────────────
# 核心函數
# ─────────────────────────────────────────────

def find_existing_image(story_id):
    """
    檢查 images/stories/ 資料夾是否已有該故事的圖片
    回傳圖片路徑，或 None
    """
    for ext in SUPPORTED_EXTENSIONS:
        path = os.path.join(IMAGES_DIR, f"{story_id}{ext}")
        if os.path.exists(path):
            return path
    return None


def get_story(stories, story_id):
    """從 stories.json 取得故事資料"""
    for story in stories:
        if story['id'] == story_id:
            return story
    return None


def build_prompt(story):
    """
    根據故事內容產生 Gemini 圖片生成 prompt
    """
    title = story.get('original_title', story['title'])
    modern_title = story['title']
    moral = story.get('moral', '')

    # 取故事文字的前 200 字作為情境描述
    text_preview = ''.join(story.get('text', []))[:200]

    # 取情緒和主題標籤
    tags = story.get('tags', {})
    themes = ', '.join(tags.get('themes', []))

    prompt = f"""Generate a contemplative illustration for a Buddhist parable:

Title: "{title}" (modern name: "{modern_title}")
Story summary: {text_preview}
Moral: {moral}
Themes: {themes}

{STYLE_GUIDE}

Create a single evocative scene that captures the essence of this parable.
Focus on the central metaphor or pivotal moment of the story.
The image should evoke quiet reflection and wisdom.
"""
    return prompt


def generate_with_gemini(prompt, api_key, output_path):
    """
    使用 Gemini API 生成圖片
    使用 REST API（不需要額外安裝 google-genai SDK）
    """
    url = f"{GEMINI_API_URL}/{GEMINI_MODEL}:generateContent?key={api_key}"

    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        }
    }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST', headers={
        'Content-Type': 'application/json'
    })

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise Exception(f"Gemini API Error {e.code}: {error_body}")

    # 從回應中提取圖片
    candidates = result.get('candidates', [])
    if not candidates:
        raise Exception("Gemini 回應中沒有 candidates")

    parts = candidates[0].get('content', {}).get('parts', [])

    for part in parts:
        if 'inlineData' in part:
            inline = part['inlineData']
            mime_type = inline.get('mimeType', 'image/png')
            image_data = base64.b64decode(inline['data'])

            # 根據 MIME 決定副檔名
            ext_map = {
                'image/png': '.png',
                'image/jpeg': '.jpg',
                'image/webp': '.webp',
            }
            ext = ext_map.get(mime_type, '.png')

            # 如果 output_path 沒有副檔名，加上
            if not any(output_path.endswith(e) for e in SUPPORTED_EXTENSIONS):
                output_path = output_path + ext

            with open(output_path, 'wb') as f:
                f.write(image_data)

            file_size_kb = len(image_data) / 1024
            print(f"   💾 圖片已儲存：{output_path} ({file_size_kb:.0f} KB)")
            return output_path

    raise Exception("Gemini 回應中沒有圖片資料")


def ensure_image(story_id, stories, api_key, force=False):
    """
    確保指定故事有圖片可用
    回傳圖片路徑

    優先順序：
    1. 手動上傳的圖片（images/stories/BDH-XXX.{png,jpg,webp}）
    2. Gemini API 自動產圖
    """
    # Step 1: 檢查手動上傳
    if not force:
        existing = find_existing_image(story_id)
        if existing:
            print(f"🖼️ 使用手動上傳圖片：{existing}")
            return existing

    # Step 2: Gemini 產圖
    story = get_story(stories, story_id)
    if not story:
        raise Exception(f"找不到故事 {story_id}")

    print(f"🎨 Gemini 產圖中... ({story['icon']} {story['title']})")
    prompt = build_prompt(story)

    # 確保資料夾存在
    os.makedirs(IMAGES_DIR, exist_ok=True)

    output_path = os.path.join(IMAGES_DIR, f"{story_id}.png")
    result_path = generate_with_gemini(prompt, api_key, output_path)

    return result_path


# ─────────────────────────────────────────────
# CLI 主程式
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='一念清涼 故事圖片產生器')
    parser.add_argument('story_id', type=str, help='故事 ID（如 BDH-001）')
    parser.add_argument('--force', action='store_true', help='強制重新產圖')
    args = parser.parse_args()

    api_key = os.environ.get('GEMINI_API_KEY', '')
    if not api_key:
        print("❌ 未設定 GEMINI_API_KEY 環境變數")
        sys.exit(1)

    stories = None
    if os.path.exists(STORIES_PATH):
        with open(STORIES_PATH, 'r', encoding='utf-8') as f:
            stories = json.load(f)

    if not stories:
        print("❌ 找不到 stories.json")
        sys.exit(1)

    try:
        path = ensure_image(args.story_id, stories, api_key, force=args.force)
        print(f"✅ 圖片就緒：{path}")
    except Exception as e:
        print(f"❌ 產圖失敗：{e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
