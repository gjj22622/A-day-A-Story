/* 一念清涼 管理儀錶板 - JavaScript */

// Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyCE1nfsYutHbw4AW8icwyfgnQ82e472JXY",
  authDomain: "yinian-qingliang.firebaseapp.com",
  projectId: "yinian-qingliang",
  databaseURL: "https://yinian-qingliang-default-rtdb.firebaseio.com",
  storageBucket: "yinian-qingliang.firebasestorage.app",
  messagingSenderId: "183912747033",
  appId: "1:183912747033:web:b3715c05503c08add49a88"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// 圖表實例儲存
const charts = {
  storyPopularity: null,
  emotionTags: null,
  sharePlatforms: null,
  dailyTrend: null
};

// 色彩配置
const brandColors = {
  gold: '#D4A574',
  jade: '#2A6B5E',
  indigo: '#0D1B2A',
  moonlight: '#C0D6DF',
  cloud: '#F5F0EB',
  muted: '#7A8B9A',
  lightBg: 'rgba(212, 165, 116, 0.2)',
  lightBg2: 'rgba(42, 107, 94, 0.2)'
};

/**
 * 初始化儀錶板
 */
function initDashboard() {
  console.log('初始化儀錶板...');

  // 監聽即時線上人數
  listenToOnlineCount();

  // 監聽日期統計數據
  listenToDailyStats();

  // 監聽事件數據
  listenToEvents();

  // 設定自動刷新（30 秒）
  setInterval(() => {
    console.log('自動刷新數據...');
    refreshCharts();
  }, 30000);
}

/**
 * 監聽即時線上人數
 */
function listenToOnlineCount() {
  const presenceRef = database.ref('presence');

  presenceRef.on('value', (snapshot) => {
    const data = snapshot.val() || {};
    const onlineCount = Object.keys(data).filter(key => data[key].online === true).length;
    document.getElementById('online-count').textContent = onlineCount;
  });
}

/**
 * 監聽日期統計數據
 */
function listenToDailyStats() {
  const dailyStatsRef = database.ref('daily_stats');

  dailyStatsRef.on('value', (snapshot) => {
    const data = snapshot.val() || {};

    // 計算今天和總數
    const today = new Date().toISOString().split('T')[0];
    let todaySessions = 0;
    let totalSessions = 0;
    let todayViews = 0;

    Object.entries(data).forEach(([date, stats]) => {
      const sessionCount = stats.session_start || 0;
      totalSessions += sessionCount;

      if (date === today) {
        todaySessions = sessionCount;
        todayViews = stats.story_view || 0;
      }
    });

    document.getElementById('today-sessions').textContent = todaySessions;
    document.getElementById('total-sessions').textContent = totalSessions;
    document.getElementById('today-views').textContent = todayViews;
  });
}

/**
 * 監聽事件數據並初始化圖表
 */
function listenToEvents() {
  const eventsRef = database.ref('events');

  eventsRef.on('value', (snapshot) => {
    const events = snapshot.val() || {};

    // 提取各類事件數據
    const storyViews = {};
    const emotionTags = {};
    const sharePlatforms = {};
    const textInputs = [];

    Object.entries(events).forEach(([eventId, event]) => {
      if (!event.type) return;

      switch (event.type) {
        case 'story_view':
          const storyId = event.storyId || '未知';
          storyViews[storyId] = (storyViews[storyId] || 0) + 1;
          break;

        case 'mood_tag_select':
          const tag = event.tag || '未知';
          emotionTags[tag] = (emotionTags[tag] || 0) + 1;
          break;

        case 'share_click':
          const platform = event.platform || '未知';
          sharePlatforms[platform] = (sharePlatforms[platform] || 0) + 1;
          break;

        case 'mood_text_input':
          textInputs.push({
            timestamp: event.timestamp || Date.now(),
            text: event.text || '',
            matchedStoryId: event.matchedStoryId || '-'
          });
          break;
      }
    });

    // 更新所有圖表
    updateStoryPopularityChart(storyViews);
    updateEmotionTagsChart(emotionTags);
    updateSharePlatformsChart(sharePlatforms);
    updateRecentInputsTable(textInputs);
  });

  // 監聽過去 30 天的日期統計
  listenToDailyTrendChart();
}

/**
 * 更新故事熱門排行圖表
 */
function updateStoryPopularityChart(storyViews) {
  // 排序並取前 10
  const sorted = Object.entries(storyViews)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const labels = sorted.map(([id]) => getStoryTitle(id));
  const data = sorted.map(([, count]) => count);

  if (sorted.length === 0) {
    document.getElementById('story-empty').classList.add('show');
    return;
  } else {
    document.getElementById('story-empty').classList.remove('show');
  }

  const ctx = document.getElementById('story-popularity-chart');

  if (charts.storyPopularity) {
    charts.storyPopularity.destroy();
  }

  charts.storyPopularity = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '閱讀次數',
        data: data,
        backgroundColor: brandColors.gold,
        borderColor: brandColors.gold,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: brandColors.moonlight,
            font: { family: "'Noto Sans TC', sans-serif" }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: brandColors.muted },
          grid: { color: 'rgba(122, 139, 154, 0.1)' }
        },
        y: {
          ticks: { color: brandColors.moonlight },
          grid: { display: false }
        }
      }
    }
  });
}

/**
 * 更新情緒標籤圖表
 */
function updateEmotionTagsChart(emotionTags) {
  // 取前 8 個標籤
  const sorted = Object.entries(emotionTags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const labels = sorted.map(([tag]) => tag);
  const data = sorted.map(([, count]) => count);

  if (sorted.length === 0) {
    document.getElementById('emotion-empty').classList.add('show');
    return;
  } else {
    document.getElementById('emotion-empty').classList.remove('show');
  }

  const ctx = document.getElementById('emotion-tags-chart');

  if (charts.emotionTags) {
    charts.emotionTags.destroy();
  }

  // 為每個標籤生成不同的顏色
  const backgroundColors = [
    'rgba(212, 165, 116, 0.8)',
    'rgba(42, 107, 94, 0.8)',
    'rgba(192, 214, 223, 0.8)',
    'rgba(122, 139, 154, 0.8)',
    'rgba(212, 165, 116, 0.6)',
    'rgba(42, 107, 94, 0.6)',
    'rgba(192, 214, 223, 0.6)',
    'rgba(122, 139, 154, 0.6)'
  ];

  charts.emotionTags = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: backgroundColors.slice(0, labels.length),
        borderColor: brandColors.indigo,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: brandColors.moonlight,
            font: { family: "'Noto Sans TC', sans-serif" },
            padding: 15
          }
        }
      }
    }
  });
}

/**
 * 更新分享平台圖表
 */
function updateSharePlatformsChart(sharePlatforms) {
  const sorted = Object.entries(sharePlatforms)
    .sort((a, b) => b[1] - a[1]);

  const labels = sorted.map(([platform]) => getPlatformName(platform));
  const data = sorted.map(([, count]) => count);

  if (sorted.length === 0) {
    document.getElementById('share-empty').classList.add('show');
    return;
  } else {
    document.getElementById('share-empty').classList.remove('show');
  }

  const ctx = document.getElementById('share-platforms-chart');

  if (charts.sharePlatforms) {
    charts.sharePlatforms.destroy();
  }

  charts.sharePlatforms = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '分享次數',
        data: data,
        backgroundColor: brandColors.jade,
        borderColor: brandColors.jade,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: brandColors.moonlight,
            font: { family: "'Noto Sans TC', sans-serif" }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: brandColors.moonlight },
          grid: { display: false }
        },
        y: {
          ticks: { color: brandColors.muted },
          grid: { color: 'rgba(122, 139, 154, 0.1)' }
        }
      }
    }
  });
}

/**
 * 更新每日趨勢圖表
 */
function listenToDailyTrendChart() {
  const dailyStatsRef = database.ref('daily_stats');

  dailyStatsRef.on('value', (snapshot) => {
    const data = snapshot.val() || {};

    // 取過去 30 天的數據
    const today = new Date();
    const dates = [];
    const counts = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const count = (data[dateStr] && data[dateStr].session_start) || 0;

      dates.push(dateStr);
      counts.push(count);
    }

    const ctx = document.getElementById('daily-trend-chart');

    if (charts.dailyTrend) {
      charts.dailyTrend.destroy();
    }

    if (counts.every(c => c === 0)) {
      document.getElementById('trend-empty').classList.add('show');
      return;
    } else {
      document.getElementById('trend-empty').classList.remove('show');
    }

    charts.dailyTrend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: '每日訪客數',
          data: counts,
          borderColor: brandColors.gold,
          backgroundColor: brandColors.lightBg,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: brandColors.gold,
          pointBorderColor: brandColors.indigo,
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: brandColors.moonlight,
              font: { family: "'Noto Sans TC', sans-serif" }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: brandColors.muted,
              maxTicksLimit: 10
            },
            grid: { color: 'rgba(122, 139, 154, 0.1)' }
          },
          y: {
            ticks: { color: brandColors.muted },
            grid: { color: 'rgba(122, 139, 154, 0.1)' }
          }
        }
      }
    });
  });
}

/**
 * 更新最近用戶輸入表格
 */
function updateRecentInputsTable(textInputs) {
  // 排序並取最新 20 筆
  const sorted = textInputs
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20);

  const tbody = document.getElementById('recent-inputs-tbody');

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="3">尚無數據</td></tr>';
    return;
  }

  tbody.innerHTML = sorted.map(entry => {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleString('zh-Hant-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    return `
      <tr>
        <td>${timeStr}</td>
        <td>${escapeHtml(entry.text)}</td>
        <td>${entry.matchedStoryId}</td>
      </tr>
    `;
  }).join('');
}

/**
 * 刷新所有圖表（手動觸發）
 */
function refreshCharts() {
  // 由於 on() 監聽器已在持續監聽，圖表會自動更新
  // 此函數保留作為未來手動刷新的入口
  console.log('圖表數據已同步');
}

/**
 * 取得故事標題（來自故事 ID）
 */
function getStoryTitle(storyId) {
  // 此處可以從 stories.json 載入故事資訊
  // 目前暫時使用故事 ID 作為標題
  const storyTitles = {
    'BDH-001': '愚人食鹽喻',
    'BDH-002': '煮黑石蜜漿喻',
    'BDH-003': '入海取沉水喻',
    'BDH-004': '渴見水喻',
    'BDH-005': '三重樓喻'
    // 可根據需要擴展
  };
  return storyTitles[storyId] || storyId;
}

/**
 * 取得平台名稱的中文翻譯
 */
function getPlatformName(platform) {
  const platformNames = {
    'line': 'LINE',
    'facebook': 'Facebook',
    'instagram': 'Instagram',
    'twitter': 'Twitter/X',
    'whatsapp': 'WhatsApp',
    'email': '電子郵件',
    'copy': '複製連結'
  };
  return platformNames[platform] || platform;
}

/**
 * HTML 逃逸函數（防止 XSS）
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * 頁面載入時初始化
 */
document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  console.log('儀錶板已載入');
});

/**
 * 頁面離開時清理監聽
 */
window.addEventListener('beforeunload', () => {
  database.ref('presence').off();
  database.ref('daily_stats').off();
  database.ref('events').off();
});
