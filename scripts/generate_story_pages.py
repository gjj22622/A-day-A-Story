#!/usr/bin/env python3
"""
一念清涼 — 故事分享頁產生器
為每則故事生成靜態 HTML 頁面（含 OG meta tags），
解決 GitHub Pages 靜態站無法動態設定 OG 標籤的問題。

生成的頁面存放在 stories/BDH-XXX/index.html，
FB/LINE/Twitter 爬蟲讀到正確 OG tags 後，
頁面自動 redirect 到主站 SPA。

使用方式：
  python generate_story_pages.py             # 生成全部 98 頁
  python generate_story_pages.py --ids BDH-001 BDH-002  # 指定故事
"""

import json
import os
import sys
import html
import argparse

STORIES_PATH = "data/stories.json"
OUTPUT_DIR = "stories"
BASE_URL = "https://gjj22622.github.io/A-day-A-Story"
FALLBACK_IMAGE = f"{BASE_URL}/og-image.png"


def escape(text):
    """HTML escape for meta tag content"""
    return html.escape(text, quote=True)


def get_og_image_url(story_id):
    """
    取得故事主圖 URL。
    圖片可能是 .png/.jpg/.webp，統一先用 .png。
    若沒有主圖，fallback 到通用 OG 圖。
    """
    # 檢查本地是否有圖片（支援多種副檔名）
    for ext in ['.png', '.jpg', '.jpeg', '.webp']:
        local_path = os.path.join("images/stories", f"{story_id}{ext}")
        if os.path.exists(local_path):
            return f"{BASE_URL}/images/stories/{story_id}{ext}"
    # 預設用 .png（圖片可能尚未產生，但路徑先設好）
    return f"{BASE_URL}/images/stories/{story_id}.png"


def generate_page(story):
    """生成單一故事的 OG 分享頁 HTML — v2 著陸頁版"""
    sid = story['id']
    icon = story.get('icon', '🪷')
    title = story['title']
    moral = story.get('moral', '')
    elaboration = story.get('elaboration', '')
    reflection = story.get('reflection', '')
    og_image = get_og_image_url(sid)
    story_url = f"{BASE_URL}/stories/{sid}/"
    redirect_url = f"{BASE_URL}/?story={sid}"
    mood_url = f"{BASE_URL}/"
    treecave_url = f"{BASE_URL}/?story={sid}&treecave=1"

    # OG description: moral + elaboration 前 150 字
    description = moral
    if elaboration:
        description = f"{moral} {elaboration}"
    if len(description) > 150:
        description = description[:147] + '...'

    og_title = f"{icon} {title} — 一念清涼"

    # 反思提問（truncate for display）
    reflection_html = ""
    if reflection:
        reflection_html = f'<p class="reflection">💭 {escape(reflection)}</p>'

    page_html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(og_title)}</title>
<!-- Open Graph / Facebook / LINE -->
<meta property="og:type" content="article">
<meta property="og:url" content="{escape(story_url)}">
<meta property="og:title" content="{escape(og_title)}">
<meta property="og:description" content="{escape(description)}">
<meta property="og:image" content="{escape(og_image)}">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="1024">
<meta property="og:locale" content="zh_TW">
<meta property="og:site_name" content="一念清涼">
<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape(og_title)}">
<meta name="twitter:description" content="{escape(description)}">
<meta name="twitter:image" content="{escape(og_image)}">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Noto Serif TC',serif;background:#0D1B2A;color:#F5F0EB;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5rem;text-align:center}}
.card{{max-width:420px;width:100%}}
.icon{{font-size:3rem;margin-bottom:0.5rem}}
h1{{color:#D4A574;font-size:1.6rem;margin-bottom:1rem;line-height:1.4}}
.moral{{color:#C0D6DF;font-size:1rem;line-height:1.8;margin-bottom:1rem;padding:0 0.5rem}}
.reflection{{color:#7A8B9A;font-size:0.9rem;line-height:1.6;margin-bottom:1.5rem;font-style:italic}}
.cta-group{{display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.5rem}}
.cta{{display:block;padding:0.85rem 1.2rem;border-radius:12px;text-decoration:none;font-size:0.95rem;transition:all 0.3s ease}}
.cta-primary{{background:#D4A574;color:#0D1B2A;font-weight:bold}}
.cta-primary:hover{{background:#e0b889}}
.cta-secondary{{border:1px solid #2A6B5E;color:#C0D6DF;background:transparent}}
.cta-secondary:hover{{background:#2A6B5E33}}
.cta-treecave{{border:1px solid #7A8B9A44;color:#7A8B9A;background:transparent}}
.cta-treecave:hover{{background:#7A8B9A22}}
.brand{{color:#7A8B9A;font-size:0.75rem;margin-top:1rem}}
.brand a{{color:#D4A574;text-decoration:none}}
.auto-hint{{color:#7A8B9A55;font-size:0.7rem;margin-top:0.5rem}}
</style>
</head>
<body>
<div class="card">
  <div class="icon">{icon}</div>
  <h1>{escape(title)}</h1>
  <p class="moral">{escape(moral)}</p>
  {reflection_html}
  <div class="cta-group">
    <a class="cta cta-primary" href="{escape(redirect_url)}">📖 閱讀完整故事</a>
    <a class="cta cta-secondary" href="{escape(mood_url)}">🪷 告訴我你的心情，為你找一則專屬故事</a>
    <a class="cta cta-treecave" href="{escape(treecave_url)}">🌳 想聊聊？進入千年樹洞</a>
  </div>
  <div class="brand">一念清涼 — 百喻經的現代智慧 · <a href="{escape(mood_url)}">探索更多故事</a></div>
  <div class="auto-hint" id="autoHint"></div>
</div>
<script>
// 社群爬蟲不執行 JS，只有人類會看到著陸頁
// 5 秒後自動跳轉到完整故事（給用戶時間看到 CTA）
var countdown = 5;
var hint = document.getElementById('autoHint');
var timer = setInterval(function() {{
  hint.textContent = countdown + ' 秒後自動前往完整故事...';
  if (countdown <= 0) {{
    clearInterval(timer);
    window.location.href = {json.dumps(redirect_url)};
  }}
  countdown--;
}}, 1000);
// 使用者點擊任何 CTA 則取消自動跳轉
document.querySelectorAll('.cta').forEach(function(el) {{
  el.addEventListener('click', function() {{ clearInterval(timer); }});
}});
</script>
</body>
</html>"""
    return page_html


def main():
    parser = argparse.ArgumentParser(description='一念清涼 故事分享頁產生器')
    parser.add_argument('--ids', nargs='+', help='指定故事 ID')
    args = parser.parse_args()

    if not os.path.exists(STORIES_PATH):
        print(f"❌ 找不到 {STORIES_PATH}")
        sys.exit(1)

    with open(STORIES_PATH, 'r', encoding='utf-8') as f:
        stories = json.load(f)

    # 篩選目標
    if args.ids:
        target_ids = set(args.ids)
        targets = [s for s in stories if s['id'] in target_ids]
    else:
        targets = stories

    print(f"📄 生成 {len(targets)} 個故事分享頁...\n")

    for story in targets:
        sid = story['id']
        out_dir = os.path.join(OUTPUT_DIR, sid)
        os.makedirs(out_dir, exist_ok=True)

        page_html = generate_page(story)
        out_path = os.path.join(out_dir, "index.html")

        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(page_html)

        print(f"  ✅ {sid} {story.get('icon','')} {story['title']}")

    print(f"\n🎉 完成！共生成 {len(targets)} 個分享頁")
    print(f"   路徑格式：{OUTPUT_DIR}/BDH-XXX/index.html")
    print(f"   分享 URL：{BASE_URL}/stories/BDH-XXX/")


if __name__ == '__main__':
    main()
