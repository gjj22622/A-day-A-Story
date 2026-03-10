#!/usr/bin/env python3
"""
一念清涼 — Facebook 貼文動態產生器
每次發文前用 Gemini 即時生成獨特文案，取代 stories.json 裡的固定模板。

6 種貼文風格隨機輪替 + 多樣化 CTA / hashtag / emoji 用法，
確保 98 則故事每篇讀起來都不一樣。
"""

import json
import os
import random
import urllib.request
import urllib.error

# ─────────────────────────────────────────────
# Gemini API
# ─────────────────────────────────────────────

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_MODEL = "gemini-2.5-flash"

# ─────────────────────────────────────────────
# 6 種貼文風格定義
# ─────────────────────────────────────────────

POST_STYLES = [
    {
        "name": "懸念型",
        "instruction": """
只講故事的前半段（約60%內容），在最精彩的轉折處停住。
結尾用一句引導語讓讀者想點進連結看完整故事。
不要揭露故事結局和寓意，讓讀者自己去發現。
語氣像在朋友耳邊說「欸你知道嗎，有一個超扯的故事…」
""",
    },
    {
        "name": "金句型",
        "instruction": """
開頭第一行就是一句有衝擊力的金句或洞見（從故事寓意提煉）。
金句之後空一行，再用2-3句話簡要帶出故事背景。
不需要完整說故事，重點在那句金句的力量。
金句要原創，不要照抄寓意原文，要更精煉、更有記憶點。
""",
    },
    {
        "name": "對比型",
        "instruction": """
用「古代 vs 現代」的對比結構。
先用1-2句話描述故事中古人做的蠢事，
然後馬上接「你覺得現代人不會這樣？」
舉2-3個具體的現代生活例子，讓讀者發現自己也在犯同樣的錯。
語氣可以帶點黑色幽默，讓人笑完之後突然覺得被戳中。
""",
    },
    {
        "name": "提問型",
        "instruction": """
開頭用一個犀利的生活問題（不是是非題，是開放式問題）。
問題要切中現代人的痛點，讓人忍不住停下來想。
問題之後再帶出故事作為「兩千年前就有人想過這個問題」的呼應。
故事只需要精簡版（3-4句），重點在問題本身的力量。
""",
    },
    {
        "name": "極短型",
        "instruction": """
整篇貼文控制在 4-6 行以內（不含 hashtag）。
用最少的字傳達最多的意思。
可以是：一句故事摘要 + 一句寓意翻譯 + 一句反問。
或是：一個場景描述 + 一句轉折 + 留白。
像俳句一樣，少即是多。每個字都要有存在的理由。
""",
    },
    {
        "name": "故事型",
        "instruction": """
像跟朋友在咖啡廳聊天一樣，完整而生動地說這個故事。
用口語化的方式重新講述，加入自己的吐槽、感嘆、轉折語氣。
可以用「我跟你說」「你猜怎麼著」「最扯的是」這類口語。
故事講完後自然地帶出感想，不要用「寓意是」「這告訴我們」這種說教語氣。
像是你真的被這個故事觸動，想分享給朋友。
""",
    },
]

# ─────────────────────────────────────────────
# CTA（行動呼籲）池 — 隨機抽取
# ─────────────────────────────────────────────

CTA_POOL = [
    "你身邊有沒有這樣的人？tag 他看看 👀",
    "看完有感覺的，留個 emoji 讓我知道",
    "完整故事在這裡，值得花一分鐘 ↓",
    "分享給那個需要聽這個故事的朋友",
    "你的版本是什麼？留言說說看",
    "如果這則故事是在說你，舉個手 🙋",
    "收藏起來，下次想不開的時候看",
    "讀完了？深呼吸一下再滑 🌿",
    "兩千年前的智慧，今天剛好用得上",
    "故事不長，但可能會想很久",
    "",  # 有時候不加 CTA
    "",
]

# ─────────────────────────────────────────────
# Hashtag 組合池 — 隨機抽取子集
# ─────────────────────────────────────────────

HASHTAG_CORE = ["#一念清涼", "#百喻經"]

HASHTAG_POOL = [
    "#佛學智慧", "#心靈成長", "#古老智慧", "#寓言故事",
    "#人生道理", "#換個角度", "#自我覺察", "#生活哲學",
    "#靜心", "#正念", "#放下", "#成長",
    "#每日一則", "#千年智慧", "#現代寓言", "#一分鐘開示",
    "#心靈雞湯不是雞湯", "#古人教我的事", "#佛經故事",
    "#mindfulness", "#innerpeace", "#wisdom",
]


def _pick_hashtags():
    """隨機組合 hashtag：2 個核心 + 3~5 個隨機"""
    extras = random.sample(HASHTAG_POOL, random.randint(3, 5))
    return " ".join(HASHTAG_CORE + extras)


def _pick_cta():
    """隨機挑一個 CTA"""
    return random.choice(CTA_POOL)


# ─────────────────────────────────────────────
# Gemini 文案生成
# ─────────────────────────────────────────────

def generate_post_with_gemini(story, api_key):
    """
    用 Gemini 根據故事內容 + 隨機風格生成 FB 貼文。
    回傳生成的文案字串，失敗則回傳 None。
    """
    if not api_key:
        return None

    # 隨機選風格
    style = random.choice(POST_STYLES)
    cta = _pick_cta()
    hashtags = _pick_hashtags()

    # 組裝故事素材
    story_text = "\n".join(story.get("text", []))
    moral = story.get("moral", "")
    elaboration = story.get("elaboration", "")
    reflection = story.get("reflection", "")
    title = story.get("title", "")
    icon = story.get("icon", "")
    original_title = story.get("original_title", "")
    link = f"https://gjj22622.github.io/A-day-A-Story/?story={story['id']}"

    prompt = f"""你是「一念清涼」Facebook 粉專的社群小編。
這個粉專把百喻經的佛學寓言用現代白話重新說給忙碌的現代人聽。
語氣溫暖但不說教，像一個有智慧的朋友在跟你聊天。

## 今天要發的故事

標題：{icon} {title}（{original_title}）

故事內容：
{story_text}

寓意：{moral}

延伸思考：{elaboration}

反思問題：{reflection}

## 你的任務

用【{style['name']}】風格寫一篇 Facebook 貼文。

### 風格要求
{style['instruction']}

### 通用規則
1. 繁體中文，台灣用語
2. 不要用「佛曰」「佛陀說」「經典告訴我們」這類宗教說教語氣
3. 不要用「親愛的朋友」「各位」這類群發信開場
4. emoji 使用克制（整篇最多 3-4 個），不要每句都加
5. 段落之間要有空行，方便手機閱讀
6. 貼文長度：極短型 4-6 行，其他風格 8-15 行（不含 hashtag）
7. 不要出現「#一念清涼」等 hashtag，我會自己加
8. 不要出現連結，我會自己加
9. 不要出現「以上」「總結」「最後」這類收尾語
10. 每篇貼文必須給人「還想再看下一篇」的感覺

### 斷句規則（非常重要！）
台灣人閱讀 Facebook 貼文的習慣是「短行 + 節奏感」，請嚴格遵守以下斷句原則：

1. **在標點符號處換行**：句號（。）、問號（？）、驚嘆號（！）、刪節號（……）後面一律換行，不要兩句話擠在同一行
2. **在驚喜點「前」斷開**：要揭露意外結果之前，先換行再寫結果。讓讀者的眼睛必須往下移才能看到答案
3. **在劇情轉折「前」斷開**：故事從A情況轉到B情況時，轉折句要獨立成行
4. **每行不超過 20 個中文字**：手機螢幕一行大約 18-20 字，超過就會自動折行，破壞節奏
5. **重要金句獨立一行**：最有力量的那句話，前後都空行，讓它自己站著
6. **逗號（，）可以斷可以不斷**：如果逗號後面是轉折或重點，就斷；如果只是語氣停頓，可以不斷

範例（好的斷句）：
```
兩千年前有個人，
嚐了一口鹽覺得好好吃。

於是他做了一個決定——
直接抓一把鹽往嘴裡塞。

結果？
他吐到不行。
```

範例（壞的斷句，不要這樣寫）：
```
兩千年前有個人嚐了一口鹽覺得好好吃，於是他做了一個決定，直接抓一把鹽往嘴裡塞，結果他吐到不行。
```

請直接輸出貼文內容，不要加任何前綴說明。"""

    # Call Gemini
    url = f"{GEMINI_API_URL}/{GEMINI_MODEL}:generateContent?key={api_key}"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.9,
            "maxOutputTokens": 1024,
        }
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "Content-Type": "application/json",
    })

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            text = result["candidates"][0]["content"]["parts"][0]["text"].strip()

            # 組裝最終貼文：AI 文案 + CTA + 連結 + hashtag
            parts = [text]
            if cta:
                parts.append(cta)
            parts.append(f"🔗 完整故事 → {link}")
            parts.append(hashtags)

            final_post = "\n\n".join(parts)

            print(f"✨ 動態文案生成成功（{style['name']}風格）")
            return final_post

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"⚠️ Gemini 文案生成失敗 ({e.code}): {error_body[:200]}")
        return None
    except Exception as e:
        print(f"⚠️ Gemini 文案生成失敗: {e}")
        return None


def get_post_content(story, api_key=None):
    """
    取得貼文內容。
    優先用 Gemini 動態生成，失敗則降級到 stories.json 的靜態文案。

    回傳 dict: {"message": str, "style": str, "is_dynamic": bool}
    """
    # 嘗試動態生成
    if api_key:
        dynamic_post = generate_post_with_gemini(story, api_key)
        if dynamic_post:
            return {
                "message": dynamic_post,
                "is_dynamic": True,
            }

    # 降級：使用靜態文案
    static_post = story.get("social", {}).get("facebook", "")
    if static_post:
        print("📋 使用靜態文案（降級模式）")
        return {
            "message": static_post,
            "is_dynamic": False,
        }

    return None


# ─────────────────────────────────────────────
# 測試用
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    stories_path = os.path.join(os.path.dirname(__file__), "..", "data", "stories.json")
    with open(stories_path, "r", encoding="utf-8") as f:
        stories = json.load(f)

    api_key = os.environ.get("GEMINI_API_KEY", "")
    story_id = sys.argv[1] if len(sys.argv) > 1 else "BDH-001"

    story = next((s for s in stories if s["id"] == story_id), None)
    if not story:
        print(f"找不到故事 {story_id}")
        sys.exit(1)

    result = get_post_content(story, api_key)
    if result:
        print(f"\n{'='*50}")
        print(f"動態生成: {result['is_dynamic']}")
        print(f"{'='*50}")
        print(result["message"])
    else:
        print("生成失敗")
