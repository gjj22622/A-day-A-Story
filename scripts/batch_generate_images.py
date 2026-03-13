#!/usr/bin/env python3
"""
一念清涼 — 批次圖片產生器
為所有 98 則故事預先產生主圖，存放於 images/stories/

使用方式：
  python batch_generate_images.py                    # 只產缺圖的故事
  python batch_generate_images.py --force             # 強制全部重新產圖
  python batch_generate_images.py --dry-run           # 預覽哪些需要產圖
  python batch_generate_images.py --ids BDH-001 BDH-002  # 只產指定故事

環境變數：
  GEMINI_API_KEY — Google AI Studio API Key

注意：Gemini API 有速率限制，批次產圖時每張間隔 5 秒
"""

import json
import os
import sys
import time
import argparse

# 加入 scripts 目錄到 path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_image import ensure_image, find_existing_image

STORIES_PATH = "data/stories.json"


def main():
    parser = argparse.ArgumentParser(description='一念清涼 批次故事圖片產生器')
    parser.add_argument('--force', action='store_true', help='強制重新產圖（覆蓋已有圖片）')
    parser.add_argument('--dry-run', action='store_true', help='預覽模式：只顯示哪些需要產圖')
    parser.add_argument('--ids', nargs='+', help='指定故事 ID 清單（如 BDH-001 BDH-002）')
    parser.add_argument('--delay', type=int, default=5, help='每張圖間隔秒數（預設 5）')
    args = parser.parse_args()

    api_key = os.environ.get('GEMINI_API_KEY', '')
    if not api_key and not args.dry_run:
        print("❌ 未設定 GEMINI_API_KEY 環境變數")
        sys.exit(1)

    # 載入故事
    if not os.path.exists(STORIES_PATH):
        print(f"❌ 找不到 {STORIES_PATH}")
        sys.exit(1)

    with open(STORIES_PATH, 'r', encoding='utf-8') as f:
        stories = json.load(f)

    print(f"📚 共 {len(stories)} 則故事")

    # 決定要處理的故事
    if args.ids:
        target_ids = set(args.ids)
        targets = [s for s in stories if s['id'] in target_ids]
        if len(targets) != len(target_ids):
            found = {s['id'] for s in targets}
            missing = target_ids - found
            print(f"⚠️ 找不到故事：{', '.join(missing)}")
    else:
        targets = stories

    # 統計
    need_generate = []
    already_exist = []

    for story in targets:
        existing = find_existing_image(story['id'])
        if existing and not args.force:
            already_exist.append(story['id'])
        else:
            need_generate.append(story)

    print(f"✅ 已有圖片：{len(already_exist)} 則")
    print(f"🎨 需要產圖：{len(need_generate)} 則")

    if args.dry_run:
        print("\n📋 需要產圖的故事：")
        for s in need_generate:
            print(f"   {s['id']} {s['icon']} {s['title']}")
        print("\n🧪 預覽模式結束（未實際產圖）")
        return

    if not need_generate:
        print("🎉 所有故事都已有圖片！")
        return

    # 批次產圖
    success = 0
    failed = []

    for i, story in enumerate(need_generate):
        print(f"\n{'─'*50}")
        print(f"[{i+1}/{len(need_generate)}] {story['id']} {story['icon']} {story['title']}")

        try:
            path = ensure_image(story['id'], stories, api_key, force=args.force)
            print(f"   ✅ 成功：{path}")
            success += 1
        except Exception as e:
            print(f"   ❌ 失敗：{e}")
            failed.append(story['id'])

        # 速率限制間隔（最後一張不用等）
        if i < len(need_generate) - 1:
            print(f"   ⏳ 等待 {args.delay} 秒...")
            time.sleep(args.delay)

    # 最終報告
    print(f"\n{'═'*50}")
    print(f"📊 批次產圖完成")
    print(f"   ✅ 成功：{success}")
    print(f"   ❌ 失敗：{len(failed)}")
    if failed:
        print(f"   失敗清單：{', '.join(failed)}")
    print(f"{'═'*50}")


if __name__ == '__main__':
    main()
