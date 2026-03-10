/**
 * 一念清涼 — 社群分享模組
 *
 * 提供完整的社群分享功能，支援 Facebook、LINE、Twitter/X、複製連結等平台
 * 使用 Web Share API 優先，並提供各平台降級方案
 *
 * 使用方式：
 *   Social.shareToFacebook(story);
 *   Social.renderShareButtons(story, containerElement);
 *   Social.copyToClipboard(story);
 */

const Social = (() => {
  // 網站基礎設定
  const BASE_URL = 'https://gjj22622.github.io/A-day-A-Story/';
  const BRAND_HASHTAGS = '#一念清涼 #佛學智慧 #百喻經';

  /**
   * 生成分享文案
   * @param {Object} story - 故事物件，需要 id, title, moral, reflection
   * @returns {string} 格式化的分享文案
   */
  const generateShareText = (story) => {
    if (!story || !story.id || !story.title) {
      console.warn('[Social] 故事物件缺少必要欄位', story);
      return '';
    }

    const lines = [
      '🪷 一念清涼 ── ' + story.title,
      '',
      '「' + (story.moral || '') + '」',
      ''
    ];

    // 反思內容（如果存在）
    if (story.reflection) {
      lines.push(story.reflection);
      lines.push('');
    }

    // 閱讀連結
    const storyUrl = getShareUrl(story);
    lines.push('▸ 讀完整故事：' + storyUrl);
    lines.push(BRAND_HASHTAGS);

    return lines.join('\n');
  };

  /**
   * 取得故事分享連結
   * @param {Object} story - 故事物件
   * @returns {string} 帶有 story 參數的完整 URL
   */
  const getShareUrl = (story) => {
    if (!story || !story.id) return BASE_URL;
    return BASE_URL + '?story=' + encodeURIComponent(story.id);
  };

  /**
   * 在新視窗開啟 Facebook 分享對話框
   * @param {Object} story - 故事物件
   */
  const shareToFacebook = (story) => {
    const url = getShareUrl(story);
    const text = generateShareText(story);

    // Facebook Sharer 使用 quote 參數來傳遞分享文案
    const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`;

    window.open(
      fbShareUrl,
      'facebook-share',
      'width=626,height=436,resizable=yes,toolbar=no,location=no'
    );

    // 追蹤分享事件
    trackShareEvent('facebook', story.id);
  };

  /**
   * LINE 分享 — 統一用 line:// URI scheme 直接呼叫 LINE app
   * 手機/桌機都優先嘗試開啟 LINE app，未安裝則複製文案提示手動貼
   *
   * ⚠️ 踩坑紀錄：
   * - 舊版用 social-plugins.line.me → 需要瀏覽器登入 LINE，已淘汰
   * - 改用 line.me/R/share → 會導到 LINE 官網首頁，無法分享
   * - 正確做法：line://msg/text/ 直接呼叫 app（手機桌機都適用）
   *
   * @param {Object} story - 故事物件
   */
  const shareToLine = (story) => {
    const url = getShareUrl(story);
    const text = generateShareText(story);
    const shareMessage = text + '\n\n' + url;

    // 統一用 line:// URI scheme 直接呼叫 LINE app
    const lineAppUrl = `line://msg/text/${encodeURIComponent(shareMessage)}`;

    const start = Date.now();
    window.location.href = lineAppUrl;

    // 若 LINE app 有開啟，頁面會跳轉；若未安裝（1 秒後仍在原頁面），降級到複製文案
    setTimeout(() => {
      if (Date.now() - start < 1500) {
        // LINE 未安裝 — 複製文案並提示
        copyToClipboard(story).then(() => {
          showCopyNotification('LINE 未偵測到，文案已複製！請開啟 LINE 手動貼上');
        });
      }
    }, 1000);

    trackShareEvent('line', story.id);
  };

  /**
   * 在新視窗開啟 Twitter/X 分享
   * @param {Object} story - 故事物件
   */
  const shareToTwitter = (story) => {
    const url = getShareUrl(story);
    const text = generateShareText(story);

    // Twitter Intent 使用 text 和 url 參數
    // Twitter 會自動縮短 URL 並計算字數
    const twitterShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

    window.open(
      twitterShareUrl,
      'twitter-share',
      'width=626,height=436,resizable=yes,toolbar=no,location=no'
    );

    trackShareEvent('twitter', story.id);
  };

  /**
   * 複製分享文案到剪貼簿
   * 用於 Instagram 分享（IG 不支援 URL 分享）或手動分享
   * @param {Object} story - 故事物件
   * @returns {Promise<boolean>} 複製成功時 resolve true
   */
  const copyToClipboard = (story) => {
    return new Promise((resolve) => {
      const text = generateShareText(story);

      // 優先使用新的 Clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text)
          .then(() => {
            console.log('[Social] 已複製到剪貼簿');
            trackShareEvent('clipboard', story.id);
            resolve(true);
          })
          .catch((err) => {
            console.error('[Social] 複製失敗:', err);
            // 降級方案：使用舊的 execCommand 方法
            fallbackCopyToClipboard(text);
            resolve(true);
          });
      } else {
        // 降級方案：用於 HTTP 或舊瀏覽器
        fallbackCopyToClipboard(text);
        resolve(true);
      }
    });
  };

  /**
   * 降級複製方案（使用 execCommand）
   * @param {string} text - 要複製的文本
   */
  const fallbackCopyToClipboard = (text) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    try {
      textarea.select();
      document.execCommand('copy');
      console.log('[Social] 已使用降級方案複製到剪貼簿');
    } catch (err) {
      console.error('[Social] 降級複製失敗:', err);
    } finally {
      document.body.removeChild(textarea);
    }
  };

  /**
   * 使用原生分享 API（如果可用）
   * 在行動裝置上效果最佳，會呼出系統分享選單
   * @param {Object} story - 故事物件
   * @returns {Promise} 分享流程的 Promise
   */
  const nativeShare = (story) => {
    // 檢查瀏覽器是否支援 Web Share API
    if (navigator.share) {
      const url = getShareUrl(story);
      const text = generateShareText(story);

      return navigator.share({
        title: '🪷 一念清涼 ── ' + story.title,
        text: text,
        url: url
      })
        .then(() => {
          console.log('[Social] 已使用原生分享');
          trackShareEvent('native_share', story.id);
        })
        .catch((err) => {
          // 用戶取消分享時 API 會 reject，但這是正常行為
          if (err.name !== 'AbortError') {
            console.error('[Social] 原生分享失敗:', err);
            // 降級方案：複製到剪貼簿
            return copyToClipboard(story);
          }
        });
    } else {
      // 原生分享不可用，使用複製方案
      return copyToClipboard(story);
    }
  };

  /**
   * 在 DOM 容器中渲染分享按鈕
   * @param {Object} story - 故事物件
   * @param {HTMLElement} container - 要插入按鈕的 DOM 元素
   */
  const renderShareButtons = (story, container) => {
    if (!container || !story || !story.id) {
      console.warn('[Social] renderShareButtons 缺少必要參數', { story, container });
      return;
    }

    // 清空容器
    container.innerHTML = '';

    // 檢查是否為行動裝置（根據 window 寬度或 navigator.userAgent）
    const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad/i.test(navigator.userAgent);
    const hasNativeShare = navigator.share !== undefined;

    // 定義分享按鈕設定
    const buttons = [
      {
        platform: 'facebook',
        label: 'Facebook',
        emoji: '👍',
        color: '#1877F2',
        handler: () => shareToFacebook(story)
      },
      {
        platform: 'line',
        label: 'LINE',
        emoji: '💬',
        color: '#06C755',
        handler: () => shareToLine(story)
      },
      {
        platform: 'twitter',
        label: 'X',
        emoji: '𝕏',
        color: '#000000',
        handler: () => shareToTwitter(story)
      },
      {
        platform: 'instagram',
        label: 'Instagram',
        emoji: '📷',
        color: 'var(--lotus-gold)',
        handler: () => copyToClipboard(story).then(() => {
          // Instagram 分享後提示用戶
          showCopyNotification('Instagram 文案已複製，請手動貼上');
        })
      }
    ];

    // 如果在行動裝置上且支援原生分享，添加原生分享按鈕
    if (isMobile && hasNativeShare) {
      buttons.unshift({
        platform: 'native_share',
        label: '更多分享',
        emoji: '↗️',
        color: 'var(--jade)',
        handler: () => nativeShare(story)
      });
    }

    // 建立按鈕 HTML
    const buttonsHTML = buttons.map((btn) => `
      <button
        class="social-share-btn social-share-btn--${btn.platform}"
        data-platform="${btn.platform}"
        style="
          background-color: ${btn.color};
          border: none;
          color: white;
          padding: 10px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-family: inherit;
          font-size: 14px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-right: 10px;
          margin-bottom: 10px;
          transition: all 0.3s ease;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        "
        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 8px rgba(0, 0, 0, 0.15)';"
        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0, 0, 0, 0.1)';"
        onclick="window.Social.handleShareButtonClick(event, '${btn.platform}', '${story.id}')"
      >
        <span>${btn.emoji}</span>
        <span>${btn.label}</span>
      </button>
    `).join('');

    // 將按鈕插入容器
    container.innerHTML = `
      <div class="social-share-buttons" style="margin: 16px 0;">
        ${buttonsHTML}
      </div>
    `;

    // 綁定事件處理器（另一種方式，使用事件委派）
    container.addEventListener('click', (event) => {
      const btn = event.target.closest('.social-share-btn');
      if (btn) {
        const platform = btn.dataset.platform;
        const storyId = story.id;
        handleShareButtonClick(event, platform, storyId);
      }
    });
  };

  /**
   * 處理分享按鈕點擊事件
   * @param {Event} event - 點擊事件
   * @param {string} platform - 平台名稱
   * @param {string} storyId - 故事 ID
   */
  const handleShareButtonClick = (event, platform, storyId) => {
    event.preventDefault();

    // 從全局存儲中取得故事物件
    if (window.currentStory && window.currentStory.id === storyId) {
      const story = window.currentStory;

      switch (platform) {
        case 'facebook':
          shareToFacebook(story);
          break;
        case 'line':
          shareToLine(story);
          break;
        case 'twitter':
          shareToTwitter(story);
          break;
        case 'instagram':
          copyToClipboard(story).then(() => {
            showCopyNotification('Instagram 文案已複製，請貼入 Instagram 貼文說明');
          });
          break;
        case 'native_share':
          nativeShare(story);
          break;
        default:
          console.warn('[Social] 未知的平台:', platform);
      }
    }
  };

  /**
   * 追蹤分享事件（如果 Analytics 物件存在）
   * @param {string} platform - 平台名稱
   * @param {string} storyId - 故事 ID
   */
  const trackShareEvent = (platform, storyId) => {
    if (window.Analytics && typeof window.Analytics.track === 'function') {
      window.Analytics.track('share_click', {
        platform: platform,
        storyId: storyId,
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * 顯示複製成功的提示通知
   * @param {string} message - 通知訊息
   */
  const showCopyNotification = (message) => {
    // 檢查是否有通知容器
    let notification = document.getElementById('social-copy-notification');

    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'social-copy-notification';
      notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background-color: var(--jade, #2A6B5E);
        color: var(--cloud, #F5F0EB);
        padding: 12px 20px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 9999;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        animation: slideUp 0.3s ease-out;
      `;
      document.body.appendChild(notification);

      // 添加動畫樣式
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
      `;
      document.head.appendChild(style);
    }

    notification.textContent = message;
    notification.style.display = 'block';

    // 3 秒後自動隱藏
    setTimeout(() => {
      notification.style.display = 'none';
    }, 3000);
  };

  /**
   * 公開 API
   */
  return {
    generateShareText,
    getShareUrl,
    shareToFacebook,
    shareToLine,
    shareToTwitter,
    copyToClipboard,
    nativeShare,
    renderShareButtons,
    handleShareButtonClick,

    // 公開工具方法
    showCopyNotification,
    trackShareEvent
  };
})();

// 將 Social 物件掛到全局作用域
window.Social = Social;
