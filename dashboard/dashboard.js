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

// 故事標題快取（從 stories.json 動態載入）
let storyTitleMap = {};

// 情緒標籤中文對照
const emotionTagNames = {
  'anxiety': '焦慮', 'fear': '恐懼', 'anger': '憤怒', 'sadness': '悲傷',
  'grief': '哀痛', 'guilt': '自責', 'regret': '後悔', 'frustration': '挫折',
  'loneliness': '孤獨', 'confusion': '困惑', 'exhaustion': '疲憊',
  'jealousy': '嫉妒', 'resentment': '怨恨', 'despair': '絕望',
  'self_doubt': '自我懷疑', 'shame': '羞恥', 'peace_seeking': '求靜',
  'hope': '希望', 'gratitude': '感恩', 'joy': '喜悅', 'relief': '釋然',
  'determination': '決心', 'curiosity': '好奇', 'love': '愛'
};

// 圖表實例儲存
const charts = {
  storyPopularity: null,
  emotionTags: null,
  sharePlatforms: null,
  dailyTrend: null,
  feedback: null,
  storyFeedback: null
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

  // 先載入故事標題對照表，完成後再監聽事件
  loadStoryTitles().then(() => {
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
  });
}

/**
 * 監聽即時線上人數
 */
function listenToOnlineCount() {
  const presenceRef = database.ref('presence');

  presenceRef.on('value', (snapshot) => {
    const data = snapshot.val() || {};
    // presence 結構: presence/{sessionId} = { timestamp, sessionId, userAgent, screenWidth }
    // 只要存在就代表在線（Firebase onDisconnect 會自動移除）
    const onlineCount = Object.keys(data).length;
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

    let todayFeedback = 0;
    let todayRandom = 0;

    Object.entries(data).forEach(([date, stats]) => {
      const sessionCount = stats.session_start || 0;
      totalSessions += sessionCount;

      if (date === today) {
        todaySessions = sessionCount;
        todayViews = stats.story_view || 0;
        todayFeedback = stats.mood_feedback || 0;
        todayRandom = stats.random_story || 0;
      }
    });

    document.getElementById('today-sessions').textContent = todaySessions;
    document.getElementById('total-sessions').textContent = totalSessions;
    document.getElementById('today-views').textContent = todayViews;
    document.getElementById('today-feedback').textContent = todayFeedback;
    document.getElementById('today-random').textContent = todayRandom;
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
    const feedbackCounts = {};
    const storyFeedbackMap = {};

    // events 結構: events/{date}/{pushId} = { eventName, data, timestamp, ... }
    Object.entries(events).forEach(([date, dateEvents]) => {
      if (!dateEvents || typeof dateEvents !== 'object') return;

      Object.entries(dateEvents).forEach(([pushId, event]) => {
        if (!event || !event.eventName) return;

        const eventData = event.data || {};

        switch (event.eventName) {
          case 'story_view':
            const storyId = eventData.storyId || '未知';
            storyViews[storyId] = (storyViews[storyId] || 0) + 1;
            break;

          case 'mood_tag_select':
            // tags 是陣列，需要逐一計數
            const tags = eventData.tags || [];
            if (Array.isArray(tags)) {
              tags.forEach(tag => {
                emotionTags[tag] = (emotionTags[tag] || 0) + 1;
              });
            }
            break;

          case 'share_click':
            const platform = eventData.platform || '未知';
            sharePlatforms[platform] = (sharePlatforms[platform] || 0) + 1;
            break;

          case 'mood_text_input':
            const matchId = eventData.matchedStoryId || '-';
            const matchTitle = eventData.matchedStoryTitle || getStoryTitle(matchId);
            textInputs.push({
              timestamp: event.timestamp || Date.now(),
              text: eventData.text || '',
              matchedStory: matchId !== '-' ? matchTitle : '-'
            });
            break;

          case 'mood_feedback':
            const fbType = eventData.feedbackType || '未知';
            feedbackCounts[fbType] = (feedbackCounts[fbType] || 0) + 1;
            // 追蹤每則故事的回饋效果
            const fbStoryId = eventData.storyId || '未知';
            if (!storyFeedbackMap[fbStoryId]) {
              storyFeedbackMap[fbStoryId] = { peace: 0, enlightened: 0, insight: 0, thinking: 0 };
            }
            if (storyFeedbackMap[fbStoryId][fbType] !== undefined) {
              storyFeedbackMap[fbStoryId][fbType]++;
            }
            break;
        }
      });
    });

    // 更新所有圖表
    updateStoryPopularityChart(storyViews);
    updateEmotionTagsChart(emotionTags);
    updateSharePlatformsChart(sharePlatforms);
    updateRecentInputsTable(textInputs);
    updateFeedbackChart(feedbackCounts);
    updateStoryFeedbackChart(storyFeedbackMap);

    // 🔴 每日優化監控面板
    updateOptimizeMetrics(events, textInputs, storyViews);
  });

  // 監聯過去 30 天的日期統計
  listenToDailyTrendChart();
}

/**
 * 🔴 每日優化核心：計算並更新所有優化監控指標
 */
function updateOptimizeMetrics(events, textInputs, storyViews) {
  // === 1. 匹配失敗率 ===
  const totalInputs = textInputs.length;
  const failedInputs = textInputs.filter(t => t.matchedStory === '-');
  const failRate = totalInputs > 0 ? Math.round((failedInputs.length / totalInputs) * 100) : 0;

  document.getElementById('match-fail-rate').textContent = totalInputs > 0 ? failRate + '%' : '-';
  document.getElementById('match-fail-detail').textContent =
    totalInputs > 0 ? `${failedInputs.length} / ${totalInputs} 次輸入未匹配` : '尚無數據';

  const failCard = document.getElementById('match-fail-card');
  if (failRate <= 10) {
    failCard.classList.add('ok');
    failCard.classList.remove('stat-card--alert');
  } else {
    failCard.classList.add('stat-card--alert');
    failCard.classList.remove('ok');
  }

  // === 2. 推薦集中度（Top1 佔比） ===
  const viewEntries = Object.entries(storyViews).sort((a, b) => b[1] - a[1]);
  const totalViews = viewEntries.reduce((sum, [, c]) => sum + c, 0);
  if (viewEntries.length > 0 && totalViews > 0) {
    const top1Pct = Math.round((viewEntries[0][1] / totalViews) * 100);
    const top1Name = getStoryTitle(viewEntries[0][0]);
    document.getElementById('recommend-concentration').textContent = top1Pct + '%';
    document.getElementById('recommend-concentration-detail').textContent =
      `Top1: ${top1Name} (${viewEntries[0][1]}次)`;
  }

  // === 3.「再抽一則」使用率 ===
  let tryAnotherCount = 0;
  let storyViewCount = 0;
  Object.values(events).forEach(dateEvents => {
    if (!dateEvents || typeof dateEvents !== 'object') return;
    Object.values(dateEvents).forEach(event => {
      if (!event || !event.eventName) return;
      if (event.eventName === 'try_another') tryAnotherCount++;
      if (event.eventName === 'story_view') storyViewCount++;
    });
  });
  const tryAnotherRate = storyViewCount > 0 ? Math.round((tryAnotherCount / storyViewCount) * 100) : 0;
  document.getElementById('try-another-rate').textContent = storyViewCount > 0 ? tryAnotherRate + '%' : '-';
  document.getElementById('try-another-detail').textContent =
    storyViewCount > 0 ? `${tryAnotherCount} 次再抽 / ${storyViewCount} 次閱讀` : '尚無數據';

  // === 4. 手機用戶佔比 ===
  let mobileCount = 0;
  let desktopCount = 0;
  Object.values(events).forEach(dateEvents => {
    if (!dateEvents || typeof dateEvents !== 'object') return;
    Object.values(dateEvents).forEach(event => {
      if (!event || event.eventName !== 'session_start') return;
      const device = event.device || {};
      const w = device.screenWidth || 0;
      if (w > 0 && w <= 768) mobileCount++;
      else if (w > 768) desktopCount++;
    });
  });
  const totalDevices = mobileCount + desktopCount;
  const mobilePct = totalDevices > 0 ? Math.round((mobileCount / totalDevices) * 100) : 0;
  document.getElementById('mobile-pct').textContent = totalDevices > 0 ? mobilePct + '%' : '-';
  document.getElementById('mobile-detail').textContent =
    totalDevices > 0 ? `手機 ${mobileCount} / 桌機 ${desktopCount}` : '尚無數據';

  // === 5. 轉換漏斗 ===
  let sessionCount = 0;
  let feedbackCount = 0;
  let shareCount = 0;
  Object.values(events).forEach(dateEvents => {
    if (!dateEvents || typeof dateEvents !== 'object') return;
    Object.values(dateEvents).forEach(event => {
      if (!event || !event.eventName) return;
      if (event.eventName === 'session_start') sessionCount++;
      if (event.eventName === 'mood_feedback') feedbackCount++;
      if (event.eventName === 'share_click') shareCount++;
    });
  });

  document.getElementById('funnel-session').textContent = sessionCount;
  document.getElementById('funnel-view').textContent = storyViewCount;
  document.getElementById('funnel-feedback').textContent = feedbackCount;
  document.getElementById('funnel-share').textContent = shareCount;

  if (sessionCount > 0) {
    const viewRate = Math.round((storyViewCount / sessionCount) * 100);
    const fbRate = Math.round((feedbackCount / sessionCount) * 100);
    const shareRate = Math.round((shareCount / sessionCount) * 100);

    document.getElementById('funnel-view-rate').textContent = viewRate + '%';
    document.getElementById('funnel-feedback-rate').textContent = fbRate + '%';
    document.getElementById('funnel-share-rate').textContent = shareRate + '%';

    document.getElementById('funnel-bar-view').style.width = Math.max(viewRate, 2) + '%';
    document.getElementById('funnel-bar-feedback').style.width = Math.max(fbRate, 2) + '%';
    document.getElementById('funnel-bar-share').style.width = Math.max(shareRate, 2) + '%';
  }

  // === 6. 未匹配關鍵字列表 ===
  updateUnmatchedTable(failedInputs);

  // === 7. 故事推薦分佈（壟斷監控） ===
  updateRecommendDistTable(storyViews, totalViews);
}

/**
 * 更新未匹配的用戶輸入表格
 */
function updateUnmatchedTable(failedInputs) {
  const tbody = document.getElementById('unmatched-inputs-tbody');

  if (failedInputs.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="3">✅ 所有輸入都有匹配，太棒了！</td></tr>';
    return;
  }

  // 聚合相同的輸入
  const counts = {};
  failedInputs.forEach(input => {
    const key = (input.text || '').trim().toLowerCase();
    if (!key) return;
    if (!counts[key]) counts[key] = { text: input.text, count: 0, lastTime: input.timestamp };
    counts[key].count++;
    if (input.timestamp > counts[key].lastTime) counts[key].lastTime = input.timestamp;
  });

  const sorted = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 30);

  tbody.innerHTML = sorted.map(entry => {
    const date = new Date(entry.lastTime);
    const timeStr = date.toLocaleString('zh-Hant-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    return `<tr>
      <td><strong>${entry.count}</strong></td>
      <td>${escapeHtml(entry.text)}</td>
      <td>${timeStr}</td>
    </tr>`;
  }).join('');
}

/**
 * 更新故事推薦分佈表（壟斷監控）
 */
function updateRecommendDistTable(storyViews, totalViews) {
  const tbody = document.getElementById('recommend-dist-tbody');
  const entries = Object.entries(storyViews).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">尚無數據</td></tr>';
    return;
  }

  const avg = totalViews / Math.max(entries.length, 1);

  tbody.innerHTML = entries.slice(0, 15).map(([storyId, count], i) => {
    const pct = totalViews > 0 ? Math.round((count / totalViews) * 100) : 0;
    const isMonopoly = count > avg * 3;
    const status = isMonopoly ? '🔴 壟斷警告' : (count > avg * 2 ? '🟡 偏高' : '✅ 正常');
    const cls = isMonopoly ? 'monopoly-warning' : '';
    return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${escapeHtml(getStoryTitle(storyId))} (${storyId})</td>
      <td>${count}</td>
      <td>${pct}%</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
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

  const labels = sorted.map(([tag]) => emotionTagNames[tag] || tag);
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
        <td>${escapeHtml(entry.matchedStory)}</td>
      </tr>
    `;
  }).join('');
}

/**
 * 更新心情回饋圖表
 */
function updateFeedbackChart(feedbackCounts) {
  const feedbackLabels = {
    'peace': '🧘 感到平靜',
    'enlightened': '💡 得到開示',
    'insight': '🪷 有所體悟',
    'thinking': '🤔 仍在思考'
  };

  const order = ['peace', 'enlightened', 'insight', 'thinking'];
  const labels = order.map(k => feedbackLabels[k] || k);
  const data = order.map(k => feedbackCounts[k] || 0);

  if (data.every(d => d === 0)) {
    document.getElementById('feedback-empty').classList.add('show');
    return;
  } else {
    document.getElementById('feedback-empty').classList.remove('show');
  }

  const ctx = document.getElementById('feedback-chart');
  if (charts.feedback) charts.feedback.destroy();

  charts.feedback = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: [
          'rgba(42, 107, 94, 0.8)',
          'rgba(212, 165, 116, 0.8)',
          'rgba(192, 214, 223, 0.8)',
          'rgba(122, 139, 154, 0.6)'
        ],
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
            font: { family: "'Noto Sans TC', sans-serif", size: 13 },
            padding: 15
          }
        }
      }
    }
  });
}

/**
 * 更新故事回饋效果排行圖表
 */
function updateStoryFeedbackChart(storyFeedbackMap) {
  // 計算每個故事的「正向回饋率」(peace + enlightened + insight)
  const storyScores = Object.entries(storyFeedbackMap).map(([storyId, counts]) => {
    const total = counts.peace + counts.enlightened + counts.insight + counts.thinking;
    const positive = counts.peace + counts.enlightened + counts.insight;
    return {
      storyId,
      title: getStoryTitle(storyId),
      total,
      positive,
      rate: total > 0 ? Math.round((positive / total) * 100) : 0
    };
  }).filter(s => s.total >= 1)
    .sort((a, b) => b.positive - a.positive)
    .slice(0, 10);

  if (storyScores.length === 0) {
    document.getElementById('story-feedback-empty').classList.add('show');
    return;
  } else {
    document.getElementById('story-feedback-empty').classList.remove('show');
  }

  const ctx = document.getElementById('story-feedback-chart');
  if (charts.storyFeedback) charts.storyFeedback.destroy();

  charts.storyFeedback = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: storyScores.map(s => s.title),
      datasets: [
        {
          label: '平靜',
          data: storyScores.map(s => storyFeedbackMap[s.storyId].peace || 0),
          backgroundColor: 'rgba(42, 107, 94, 0.8)',
          borderRadius: 2
        },
        {
          label: '開示',
          data: storyScores.map(s => storyFeedbackMap[s.storyId].enlightened || 0),
          backgroundColor: 'rgba(212, 165, 116, 0.8)',
          borderRadius: 2
        },
        {
          label: '體悟',
          data: storyScores.map(s => storyFeedbackMap[s.storyId].insight || 0),
          backgroundColor: 'rgba(192, 214, 223, 0.8)',
          borderRadius: 2
        },
        {
          label: '思考中',
          data: storyScores.map(s => storyFeedbackMap[s.storyId].thinking || 0),
          backgroundColor: 'rgba(122, 139, 154, 0.5)',
          borderRadius: 2
        }
      ]
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
          stacked: true,
          ticks: { color: brandColors.muted },
          grid: { color: 'rgba(122, 139, 154, 0.1)' }
        },
        y: {
          stacked: true,
          ticks: { color: brandColors.moonlight },
          grid: { display: false }
        }
      }
    }
  });
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
 * 從 stories.json 載入所有故事標題（回傳 Promise）
 */
function loadStoryTitles() {
  return fetch('../data/stories.json')
    .then(res => res.json())
    .then(stories => {
      stories.forEach(story => {
        storyTitleMap[story.id] = story.title || story.original_title || story.id;
      });
      console.log(`已載入 ${Object.keys(storyTitleMap).length} 則故事標題`);
    })
    .catch(err => {
      console.warn('無法載入 stories.json，使用故事 ID 作為標題', err);
    });
}

/**
 * 取得故事標題（來自故事 ID）
 */
function getStoryTitle(storyId) {
  return storyTitleMap[storyId] || storyId;
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
