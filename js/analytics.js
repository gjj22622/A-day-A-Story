/**
 * 一念清涼 — 分析追蹤模組
 *
 * 功能：
 * - Firebase Realtime Database 初始化
 * - 使用者事件追蹤
 * - 在線狀態追蹤
 * - 每日統計計數
 *
 * 使用方式：
 *   Analytics.init()
 *   Analytics.track('story_view', { storyId: 'BDH-001', title: '只吃鹽的人' })
 */

const Analytics = (() => {
  // Firebase 配置
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCE1nfsYutHbw4AW8icwyfgnQ82e472JXY',
    authDomain: 'yinian-qingliang.firebaseapp.com',
    projectId: 'yinian-qingliang',
    storageBucket: 'yinian-qingliang.firebasestorage.app',
    messagingSenderId: '183912747033',
    appId: '1:183912747033:web:b3715c05503c08add49a88',
    databaseURL: 'https://yinian-qingliang-default-rtdb.firebaseio.com'
  };

  // 內部狀態
  let isInitialized = false;
  let db = null;
  let sessionId = null;
  let userAgent = '';

  /**
   * 初始化 Firebase 和分析追蹤
   */
  const init = () => {
    try {
      // 檢查 Firebase SDK 是否已載入
      if (typeof firebase === 'undefined') {
        console.warn('一念清涼: Firebase SDK 未載入，請確保在 HTML 中包含 Firebase CDN script');
        return false;
      }

      // 初始化 Firebase App
      const app = firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.database(app);

      // 獲取或建立 sessionId
      sessionId = getSessionId();

      // 簡化 userAgent（避免個資）
      userAgent = simplifyUserAgent(navigator.userAgent);

      // 標記初始化完成（必須在 track() 之前，否則 track 會因未初始化而跳過）
      isInitialized = true;

      // 設置在線狀態追蹤
      setupPresenceTracking();

      // 記錄 session_start 事件
      track('session_start', {
        url: window.location.pathname,
        referrer: document.referrer || 'direct'
      });

      // 頁面卸載時清理
      window.addEventListener('beforeunload', () => {
        removePresence();
      });
      console.log('一念清涼: 分析模組初始化完成');
      return true;
    } catch (error) {
      console.error('一念清涼: 分析模組初始化失敗', error);
      return false;
    }
  };

  /**
   * 簡化 userAgent（只保留瀏覽器和 OS 資訊）
   */
  const simplifyUserAgent = (ua) => {
    let browser = 'Unknown';
    let os = 'Unknown';

    // 檢測作業系統
    if (/Windows/.test(ua)) os = 'Windows';
    else if (/Macintosh/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Android/.test(ua)) os = 'Android';

    // 檢測瀏覽器
    if (/Chrome/.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
    else if (/Safari/.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    else if (/Firefox/.test(ua)) browser = 'Firefox';
    else if (/Edge/.test(ua)) browser = 'Edge';

    return `${browser}/${os}`;
  };

  /**
   * 取得或建立 Session ID
   * 使用 sessionStorage 在瀏覽器 tab 生命週期內保持一致
   */
  const getSessionId = () => {
    try {
      let id = sessionStorage.getItem('yinian_session_id');
      if (!id) {
        // 生成 UUID v4
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
        sessionStorage.setItem('yinian_session_id', id);
      }
      return id;
    } catch (error) {
      // 如果 sessionStorage 不可用，返回臨時 ID
      return 'temp-' + Date.now();
    }
  };

  /**
   * 設置在線狀態追蹤
   * 當使用者連線時寫入 presence，斷線時自動清除
   */
  const setupPresenceTracking = () => {
    try {
      const presenceRef = db.ref('.info/connected');
      presenceRef.on('value', (snapshot) => {
        if (snapshot.val() === true) {
          // 使用者已連線
          const userPresenceRef = db.ref(`presence/${sessionId}`);
          userPresenceRef.set({
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            sessionId: sessionId,
            userAgent: userAgent,
            screenWidth: window.innerWidth
          });

          // 當連線中斷時，Firebase 會自動刪除此路徑
          userPresenceRef.onDisconnect().remove();
        }
      });
    } catch (error) {
      console.error('一念清涼: 在線追蹤設置失敗', error);
    }
  };

  /**
   * 移除 Presence 記錄（頁面卸載時）
   */
  const removePresence = () => {
    try {
      if (db && sessionId) {
        db.ref(`presence/${sessionId}`).remove().catch(() => {
          // 忽略錯誤，可能連線已斷開
        });
      }
    } catch (error) {
      // 忽略清理時的錯誤
    }
  };

  /**
   * 記錄事件到 Firebase
   * @param {string} eventName - 事件名稱
   * @param {object} data - 事件資料
   */
  const track = (eventName, data = {}) => {
    try {
      if (!isInitialized || !db || !sessionId) {
        console.warn('一念清涼: 分析模組未初始化');
        return;
      }

      const now = new Date();
      const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const timestamp = now.toISOString();

      const eventData = {
        timestamp: timestamp,
        sessionId: sessionId,
        eventName: eventName,
        data: data,
        device: {
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
          userAgent: userAgent
        }
      };

      // 非同步寫入事件（fire and forget）
      const eventsRef = db.ref(`events/${dateKey}`);
      eventsRef.push(eventData).catch((error) => {
        console.error(`一念清涼: 記錄事件 "${eventName}" 失敗`, error);
      });

      // 同時更新每日統計計數
      trackDailyStats(eventName);
    } catch (error) {
      console.error('一念清涼: track() 發生錯誤', error);
    }
  };

  /**
   * 增加每日統計計數
   * @param {string} eventName - 事件名稱
   */
  const trackDailyStats = (eventName) => {
    try {
      if (!isInitialized || !db) {
        return;
      }

      const now = new Date();
      const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const statsRef = db.ref(`daily_stats/${dateKey}/${eventName}`);

      // 使用 transaction 確保計數準確
      statsRef.transaction((currentValue) => {
        return (currentValue || 0) + 1;
      }).catch((error) => {
        console.error(`一念清涼: 更新統計 "${eventName}" 失敗`, error);
      });
    } catch (error) {
      console.error('一念清涼: trackDailyStats() 發生錯誤', error);
    }
  };

  /**
   * 記錄情緒標籤選擇
   * @param {array} tags - 標籤陣列
   */
  const trackMoodTags = (tags) => {
    track('mood_tag_select', {
      tags: Array.isArray(tags) ? tags : [],
      count: Array.isArray(tags) ? tags.length : 0
    });
  };

  /**
   * 記錄自由文字輸入
   * @param {string} text - 使用者輸入的文字
   */
  const trackMoodText = (text) => {
    track('mood_text_input', {
      textLength: typeof text === 'string' ? text.length : 0,
      hasText: !!text
    });
  };

  /**
   * 記錄故事檢視
   * @param {string} storyId - 故事 ID
   * @param {string} style - 故事風格
   * @param {string} title - 故事標題
   */
  const trackStoryView = (storyId, style, title) => {
    track('story_view', {
      storyId: storyId,
      style: style,
      title: title
    });
  };

  /**
   * 記錄故事互動
   * @param {string} type - 互動類型（typewriter_skip|line_click|qa_choice|build_next）
   * @param {string} storyId - 故事 ID
   * @param {object} detail - 額外細節
   */
  const trackStoryInteract = (type, storyId, detail = {}) => {
    track('story_interact', {
      type: type,
      storyId: storyId,
      detail: detail
    });
  };

  /**
   * 記錄原文切換
   * @param {string} storyId - 故事 ID
   * @param {boolean} isVisible - 原文是否顯示
   */
  const trackOriginalToggle = (storyId, isVisible) => {
    track('original_toggle', {
      storyId: storyId,
      isVisible: isVisible
    });
  };

  /**
   * 記錄分享點擊
   * @param {string} platform - 平台名稱（ig|line|facebook|other）
   * @param {string} storyId - 故事 ID
   */
  const trackShare = (platform, storyId) => {
    track('share_click', {
      platform: platform,
      storyId: storyId
    });
  };

  /**
   * 記錄「再找一個」動作
   * @param {string} fromStoryId - 原故事 ID
   */
  const trackTryAnother = (fromStoryId) => {
    track('try_another', {
      fromStoryId: fromStoryId
    });
  };

  /**
   * 取得當前 Session ID
   */
  const getSession = () => {
    return sessionId;
  };

  // 公開 API
  return {
    init: init,
    track: track,
    trackDailyStats: trackDailyStats,
    trackMoodTags: trackMoodTags,
    trackMoodText: trackMoodText,
    trackStoryView: trackStoryView,
    trackStoryInteract: trackStoryInteract,
    trackOriginalToggle: trackOriginalToggle,
    trackShare: trackShare,
    trackTryAnother: trackTryAnother,
    getSessionId: getSession
  };
})();

// 全域暴露
window.Analytics = Analytics;
