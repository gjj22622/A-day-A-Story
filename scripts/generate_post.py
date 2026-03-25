#!/usr/bin/env python3
"""
一念清涼 — Facebook 貼文動態產生器
每次發文前用 Gemini 即時生成獨特文案，取代 stories.json 裡的固定模板。

6 種貼文風格隨機輪替 + 多樣化 CTA / hashtag / emoji 用法，
確保 98 則故事每篇讀起來都不一樣。

v2 策略轉向：「勾引式」文案 — 不在 FB 上把故事講完，留懸念引導點擊。
v3 品牌重塑 50+：受眾轉向 50 歲以上、語調從「年輕朋友」改為「老友泡茶聊天」。
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
# 6 種貼文風格定義（v2 勾引式）
# ─────────────────────────────────────────────

POST_STYLES = [
    {
        "name": "懸念型",
        "instruction": """
只講故事的前半段（約40-50%內容），在最精彩的轉折處「硬生生」停住。
結尾刻意留白，讓讀者好奇心爆發——「然後呢？」
絕對不要揭露結局、寓意、或任何教訓。
語氣像午後跟老朋友喝茶時說「欸，我最近看到一個故事，你一定有感覺…」
前半段把故事說到最像讀者自己生活的那個點，然後停住。
讓他覺得「這不就是我嗎」，忍不住點進去看結局。
""",
    },
    {
        "name": "金句型",
        "instruction": """
開頭第一行就是一句有閱歷感的金句（從故事寓意提煉）。
不要年輕人的「衝擊力」，要的是那種「安靜地戳中你」的力量。
金句之後空一行，再用2-3句話帶出故事「背景」但不說「結論」。
金句要原創，像一個活了很久的人才說得出來的話。
適合在 LINE 轉傳給朋友的那種句子。
結尾暗示「這句話背後有一個一千五百年前的故事」引導點入。
""",
    },
    {
        "name": "對比型",
        "instruction": """
用「古代 vs 你現在的生活」做對比。
先用1-2句話描述故事中古人做的事，
然後馬上接「你覺得我們不會這樣？」
舉2-3個 50 歲以上的人會遇到的生活場景：照顧父母、跟孩子的代溝、
身體的變化、職場裡被年輕人追著跑、忍了半輩子的婚姻。
語氣帶點會心一笑的觀察力——「原來一千五百年前就有人跟我一樣」。
不要說破「所以這個故事教我們什麼」——讓他們自己點進去看。
""",
    },
    {
        "name": "提問型",
        "instruction": """
開頭用一個 50 歲以上的人藏在心底、平常不好意思說出口的問題。
不是尖銳的問題，是「你看到會愣住三秒鐘」的問題。
例如：「你有多久沒有為自己做一個決定了？」
「如果明天什麼責任都不用扛，你最想做什麼？」
「這輩子你忍了多少沒說出口的話？」
問完之後簡單暗示「一千五百年前有個人也面對了同樣的問題」。
故事只提一兩句設定，完全不透露結局。
""",
    },
    {
        "name": "極短型",
        "instruction": """
整篇貼文控制在 4-6 行以內（不含 hashtag）。
像一杯茶，只有兩三口，但喝完會回甘。
寫給那些滑 FB 只有三秒鐘注意力、但看到對的字會停下來的人。
50 歲以上的人不需要長篇大論，一句話就夠了——前提是那句話真的說到心裡。
可以是：一個矛盾的場景 + 一句懸念 + 留白。
絕對不要講完故事，只給一個「鉤子」。
""",
    },
    {
        "name": "故事型",
        "instruction": """
像跟多年老友在客廳泡茶，慢慢說一個故事——但只說到高潮前。
用口語化的方式講述開場和發展，加入自己的感嘆、驚訝、搖頭嘆氣。
可以用「我跟你說」「你猜怎麼著」「最妙的是」這類口語。
講到最關鍵的轉折就停住，說「後面的發展你自己去看比較有感覺」。
不要講結局，不要講寓意，不要說教。他們什麼道理都聽過了。
""",
    },
]

# ─────────────────────────────────────────────
# CTA（行動呼籲）池 — v2 強化導流
# ─────────────────────────────────────────────

CTA_POOL = [
    "如果身邊有人也需要歇一歇，把這則故事傳給他 🪷",
    "不用留言，但如果你也有感覺，點個讚讓我知道你在",
    "讀完了？不急著滑走，深呼吸一下 🍃",
    "一千五百年前就有人跟你一樣了。你不孤單。",
    "如果這則故事像在說你，那它可能真的在說你",
    "收藏起來，哪天心累的時候再看一次",
    "完整故事不長，值得花一分鐘靜靜看完 ↓",
    "故事不長，但你可能會想很久",
    "點進來，還可以跟千年樹洞說說心裡話 🌳",
    "",  # 有時候不加 CTA
    "",
]

# ─────────────────────────────────────────────
# Hashtag 組合池 — 隨機抽取子集
# ─────────────────────────────────────────────

HASHTAG_CORE = ["#一念清涼", "#百喻經"]

HASHTAG_POOL = [
    "#千年智慧現代解讀", "#古人也懂你", "#今天的一念",
    "#走過才懂", "#人生下半場", "#歇一歇也沒關係",
    "#不是只有你這樣", "#老故事新感動",
    "#古老智慧", "#寓言故事", "#換個角度",
    "#自我覺察", "#生活哲學", "#放下",
    "#古人教我的事", "#佛經故事",
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
    link = f"https://gjj22622.github.io/A-day-A-Story/stories/{story['id']}/"

    prompt = f"""你是「一念清涼」Facebook 粉專的撰稿人。
這個粉專用百喻經的寓言故事，陪伴 50 歲以上正在人生路上咬牙撐著的人。
他們可能是還在打拚的上班族、扛著全家的三明治族、或是開始問自己「然後呢」的中年人。
語氣要像一個走過同樣路的老朋友，泡著茶跟你說：「欸，我跟你講一個故事，你聽聽看。」
不說教、不雞湯、不賣弄。他們什麼道理都聽過了，他們需要的不是道理，是有人懂。

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

### 核心策略：勾引式文案（非常重要！）
你的目標是讓讀者「點進連結」去網站看完整故事，而不是在 Facebook 上就讀完。
所以你必須：
- 只給出足夠引起好奇心的內容
- 絕對不要把故事講完
- 絕對不要揭露寓意或教訓
- 讓讀者覺得「我一定要點進去看看」
- 結尾要有懸念感或好奇心缺口

### 通用規則
1. 繁體中文，台灣用語
2. 不要用「佛曰」「佛陀說」「經典告訴我們」這類宗教說教語氣
3. 不要用「親愛的朋友」「各位」這類群發信開場
4. 不要用年輕人流行語：躺平、社畜、emo、FOMO、內卷、社恐、佛系
5. emoji 使用克制（整篇最多 3-4 個），不要每句都加
6. 段落之間要有空行，方便手機閱讀（50+ 讀者眼睛需要更多留白）
7. 貼文長度：極短型 4-6 行，其他風格 8-15 行（不含 hashtag）
8. 不要出現「#一念清涼」等 hashtag，我會自己加
9. 不要出現連結，我會自己加
10. 不要出現「以上」「總結」「最後」這類收尾語
11. 記住受眾是 50+：他們在乎的是家庭、健康、職場尊嚴、人生意義，不是升學考試或感情煩惱
12. 每篇貼文要讓人覺得「原來不是只有我這樣」，而不是「不點進去會錯過什麼」

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
        "Referer": "https://gjj22622.github.io/",
    })

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            text = result["candidates"][0]["content"]["parts"][0]["text"].strip()

            # 組裝最終貼文：AI 文案 + CTA + 連結 + hashtag
            parts = [text]
            if cta:
                parts.append(cta)
            parts.append(f"🪷 坐下來，聽完這則故事 → {link}")
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
