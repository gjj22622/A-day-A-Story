/* 一念清涼 AI API 成本監控 — usage-monitor.js */

// ===== Firebase 配置 =====
const firebaseConfig = {
  apiKey: "AIzaSyCE1nfsYutHbw4AW8icwyfgnQ82e472JXY",
  authDomain: "yinian-qingliang.firebaseapp.com",
  projectId: "yinian-qingliang",
  databaseURL: "https://yinian-qingliang-default-rtdb.firebaseio.com",
  storageBucket: "yinian-qingliang.firebasestorage.app",
  messagingSenderId: "183912747033",
  appId: "1:183912747033:web:b3715c05503c08add49a88"
};

// ===== 定價常數 =====
const PRICING = {
  inputPerMillion: 0.30,   // Paid Tier: $0.30 / 1M input tokens
  outputPerMillion: 2.50,  // Paid Tier: $2.50 / 1M output tokens
  freeRPD: 1500            // Free Tier: ~1,500 requests per day
};

// ===== 預算管理 =====
const BUDGET = {
  monthlyLimit: 30.00,     // 每月預算上限 (USD)
  warningThreshold: 0.8    // 80% 時顯示警告
};

// ===== 登入驗證 =====
const AUTH_USER = 'Admin';
const AUTH_HASH = 'ea34564517d272f65dadf8347081041d337076b0dff46f72ca2bc3643b6222d4';

async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleLogin(e) {
  e.preventDefault();
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('loginError');

  if (user !== AUTH_USER) {
    errorEl.textContent = '帳號或密碼錯誤';
    return false;
  }
  const passHash = await sha256(pass);
  if (passHash !== AUTH_HASH) {
    errorEl.textContent = '帳號或密碼錯誤';
    return false;
  }

  try { sessionStorage.setItem('yinian_usage_auth', 'true'); } catch(e) {}
  showMonitor();
  return false;
}

function showMonitor() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('topbar').style.display = '';
  document.getElementById('mainContent').style.display = '';
  initUsageMonitor();
}

// 自動檢查登入狀態
try {
  if (sessionStorage.getItem('yinian_usage_auth') === 'true') {
    showMonitor();
  }
} catch(e) {}

// ===== 工具函數 =====
function fmtNum(n) {
  return Number(n || 0).toLocaleString('zh-TW');
}

function fmtUsd(n) {
  return '$' + Number(n || 0).toFixed(4);
}

function calcCost(inputTokens, outputTokens) {
  return (inputTokens / 1e6) * PRICING.inputPerMillion
       + (outputTokens / 1e6) * PRICING.outputPerMillion;
}

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ===== 主要初始化 =====
let database = null;
let dailyChart = null;

function initUsageMonitor() {
  if (database) return; // 避免重複初始化

  firebase.initializeApp(firebaseConfig);
  database = firebase.database();

  document.getElementById('updatedAt').textContent = '正在載入 Firebase 資料...';

  // 監聽 events 底下所有日期的 ai_api_call 事件
  const eventsRef = database.ref('events');
  eventsRef.on('value', snap => {
    const allEvents = snap.val();
    if (!allEvents) {
      document.getElementById('updatedAt').textContent = '尚無 AI 呼叫資料';
      return;
    }
    processAllEvents(allEvents);
  });
}

// ===== 解析所有事件 =====
function processAllEvents(allEvents) {
  const today = getTodayStr();
  const dailyMap = {}; // { "2026-03-10": { calls, success, fail, inputTokens, outputTokens, match:{...}, chat:{...} } }

  const emptyFeatureStats = () => ({ calls: 0, success: 0, fail: 0, inputTokens: 0, outputTokens: 0 });
  const emptyDayStats = () => ({
    calls: 0, success: 0, fail: 0, inputTokens: 0, outputTokens: 0,
    match: emptyFeatureStats(),
    chat: emptyFeatureStats()
  });

  // 遍歷每個日期
  for (const date of Object.keys(allEvents)) {
    const dayEvents = allEvents[date];
    if (!dayEvents || typeof dayEvents !== 'object') continue;

    // 遍歷該日期下的所有事件
    for (const evtId of Object.keys(dayEvents)) {
      const evt = dayEvents[evtId];
      if (!evt || evt.eventName !== 'ai_api_call') continue;

      if (!dailyMap[date]) dailyMap[date] = emptyDayStats();

      const d = dailyMap[date];
      d.calls++;

      // 辨識 feature: 'match' 或 'chat'
      const feature = evt.feature || 'match'; // 預設為 match（向下相容）
      const featureStats = feature === 'chat' ? d.chat : d.match;
      featureStats.calls++;

      if (evt.success === true) {
        d.success++;
        featureStats.success++;
        const inTk = evt.promptTokens || 0;
        const outTk = evt.outputTokens || 0;
        d.inputTokens += inTk;
        d.outputTokens += outTk;
        featureStats.inputTokens += inTk;
        featureStats.outputTokens += outTk;
      } else {
        d.fail++;
        featureStats.fail++;
      }
    }
  }

  // 排序日期（新→舊）
  const sortedDates = Object.keys(dailyMap).sort().reverse();

  // 計算今日統計
  const todayData = dailyMap[today] || emptyDayStats();
  renderTodayStats(todayData);

  // 計算累計統計
  const totalData = emptyDayStats();
  for (const date of sortedDates) {
    const d = dailyMap[date];
    totalData.calls += d.calls;
    totalData.success += d.success;
    totalData.fail += d.fail;
    totalData.inputTokens += d.inputTokens;
    totalData.outputTokens += d.outputTokens;
    totalData.match.calls += d.match.calls;
    totalData.match.inputTokens += d.match.inputTokens;
    totalData.match.outputTokens += d.match.outputTokens;
    totalData.chat.calls += d.chat.calls;
    totalData.chat.inputTokens += d.chat.inputTokens;
    totalData.chat.outputTokens += d.chat.outputTokens;
  }
  renderTotalStats(totalData);

  // Free Tier 用量條
  renderUsageBar(todayData.calls);

  // 🔴 預算警示
  renderBudgetAlert(totalData);

  // Match vs Chat 分離統計
  renderFeatureBreakdown(totalData);

  // 每日趨勢圖（最近30天）
  renderDailyChart(dailyMap);

  // 每日明細表
  renderDailyTable(sortedDates, dailyMap);

  // 更新時間
  document.getElementById('updatedAt').textContent =
    `即時更新 | 今日：${today} | 共 ${sortedDates.length} 天資料`;
}

// ===== 渲染今日統計 =====
function renderTodayStats(data) {
  document.getElementById('todayCalls').textContent = fmtNum(data.calls);

  const rate = data.calls > 0 ? ((data.success / data.calls) * 100).toFixed(1) : '-';
  document.getElementById('todaySuccessRate').textContent = data.calls > 0 ? rate + '%' : '-';
  document.getElementById('todaySuccessDetail').textContent =
    data.calls > 0 ? `${data.success} 成功 / ${data.fail} 失敗` : '';

  document.getElementById('todayInputTokens').textContent = fmtNum(data.inputTokens);
  const inputCost = (data.inputTokens / 1e6) * PRICING.inputPerMillion;
  document.getElementById('todayInputCost').textContent = fmtUsd(inputCost);

  document.getElementById('todayOutputTokens').textContent = fmtNum(data.outputTokens);
  const outputCost = (data.outputTokens / 1e6) * PRICING.outputPerMillion;
  document.getElementById('todayOutputCost').textContent = fmtUsd(outputCost);

  const totalCost = inputCost + outputCost;
  document.getElementById('todayTotalCost').textContent = fmtUsd(totalCost);
}

// ===== 渲染累計統計 =====
function renderTotalStats(data) {
  document.getElementById('totalCalls').textContent = fmtNum(data.calls);

  document.getElementById('totalInputTokens').textContent = fmtNum(data.inputTokens);
  const inputCost = (data.inputTokens / 1e6) * PRICING.inputPerMillion;
  document.getElementById('totalInputCost').textContent = fmtUsd(inputCost);

  document.getElementById('totalOutputTokens').textContent = fmtNum(data.outputTokens);
  const outputCost = (data.outputTokens / 1e6) * PRICING.outputPerMillion;
  document.getElementById('totalOutputCost').textContent = fmtUsd(outputCost);

  const totalCost = inputCost + outputCost;
  document.getElementById('totalCost').textContent = fmtUsd(totalCost);
}

// ===== Free Tier 用量條 =====
function renderUsageBar(todayCalls) {
  const pct = Math.min((todayCalls / PRICING.freeRPD) * 100, 100);
  const pctStr = pct.toFixed(1) + '%';

  document.getElementById('usagePct').textContent = pctStr;
  document.getElementById('usageDetail').textContent =
    `${fmtNum(todayCalls)} / ${fmtNum(PRICING.freeRPD)} RPD`;

  const bar = document.getElementById('usageBar');
  bar.style.width = pctStr;
  bar.textContent = pctStr;

  // 顏色指示：低=綠，中=金，高=紅
  if (pct < 50) {
    bar.style.background = '#2A6B5E'; // jade
  } else if (pct < 80) {
    bar.style.background = '#D4A574'; // gold
  } else {
    bar.style.background = '#e74c3c'; // red
  }
}

// ===== 每日趨勢圖 =====
function renderDailyChart(dailyMap) {
  const canvas = document.getElementById('dailyApiChart');
  const emptyMsg = document.getElementById('chartEmpty');

  // 取最近30天
  const dates = Object.keys(dailyMap).sort();
  const last30 = dates.slice(-30);

  if (last30.length === 0) {
    canvas.style.display = 'none';
    emptyMsg.style.display = '';
    return;
  }
  canvas.style.display = '';
  emptyMsg.style.display = 'none';

  const labels = last30.map(d => d.substring(5)); // "03-10"
  const callsData = last30.map(d => dailyMap[d].calls);
  const successData = last30.map(d => dailyMap[d].success);
  const costData = last30.map(d => calcCost(dailyMap[d].inputTokens, dailyMap[d].outputTokens));

  if (dailyChart) dailyChart.destroy();

  dailyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'AI 呼叫次數',
          data: callsData,
          backgroundColor: 'rgba(212,165,116,0.7)',
          borderColor: '#D4A574',
          borderWidth: 1,
          yAxisID: 'y'
        },
        {
          label: '成功次數',
          data: successData,
          backgroundColor: 'rgba(42,107,94,0.7)',
          borderColor: '#2A6B5E',
          borderWidth: 1,
          yAxisID: 'y'
        },
        {
          label: '預估費用 (USD)',
          data: costData,
          type: 'line',
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231,76,60,0.1)',
          fill: true,
          tension: 0.3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          ticks: { color: '#91a0ad', font: { size: 11 } },
          grid: { color: 'rgba(47,70,90,0.5)' }
        },
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: '呼叫次數', color: '#91a0ad' },
          ticks: { color: '#91a0ad', stepSize: 1 },
          grid: { color: 'rgba(47,70,90,0.3)' },
          beginAtZero: true
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: '費用 (USD)', color: '#e74c3c' },
          ticks: { color: '#e74c3c', callback: v => '$' + v.toFixed(4) },
          grid: { drawOnChartArea: false },
          beginAtZero: true
        }
      },
      plugins: {
        legend: {
          labels: { color: '#d8e1e8', font: { family: 'Noto Sans TC' } }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              if (ctx.dataset.yAxisID === 'y1') {
                return ctx.dataset.label + ': $' + ctx.parsed.y.toFixed(4);
              }
              return ctx.dataset.label + ': ' + ctx.parsed.y;
            }
          }
        }
      }
    }
  });
}

// ===== 每日明細表 =====
function renderDailyTable(sortedDates, dailyMap) {
  const tbody = document.getElementById('dailyLogBody');

  if (sortedDates.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">尚無資料</td></tr>';
    return;
  }

  tbody.innerHTML = sortedDates.map(date => {
    const d = dailyMap[date];
    const cost = calcCost(d.inputTokens, d.outputTokens);
    const successPct = d.calls > 0 ? ((d.success / d.calls) * 100).toFixed(0) : '0';
    return `<tr>
      <td>${date}</td>
      <td>${fmtNum(d.calls)}</td>
      <td>${fmtNum(d.match.calls)}</td>
      <td>${fmtNum(d.chat.calls)}</td>
      <td>${fmtNum(d.success)} <span style="color:var(--muted);font-size:0.8em">(${successPct}%)</span></td>
      <td>${d.fail > 0 ? '<span style="color:#e74c3c">' + d.fail + '</span>' : '0'}</td>
      <td>${fmtNum(d.inputTokens)}</td>
      <td>${fmtNum(d.outputTokens)}</td>
      <td>${fmtUsd(cost)}</td>
    </tr>`;
  }).join('');
}

// ===== 🔴 預算警示 =====
function renderBudgetAlert(totalData) {
  const totalCost = calcCost(totalData.inputTokens, totalData.outputTokens);
  const remaining = BUDGET.monthlyLimit - totalCost;
  const usagePct = (totalCost / BUDGET.monthlyLimit) * 100;

  const alertEl = document.getElementById('budgetAlert');
  const remainEl = document.getElementById('budgetRemaining');
  const barEl = document.getElementById('budgetBar');
  const pctEl = document.getElementById('budgetPct');

  if (!alertEl) return; // 防止 HTML 未更新

  // 更新預算條
  const barPct = Math.min(usagePct, 100);
  barEl.style.width = barPct.toFixed(1) + '%';
  barEl.textContent = barPct.toFixed(1) + '%';
  pctEl.textContent = barPct.toFixed(1) + '%';
  remainEl.textContent = `已用 ${fmtUsd(totalCost)} / 預算 $${BUDGET.monthlyLimit.toFixed(2)} | 剩餘 ${fmtUsd(remaining)}`;

  // 顏色指示
  if (usagePct >= 100) {
    barEl.style.background = '#e74c3c';
    alertEl.style.display = '';
    alertEl.className = 'budget-alert budget-danger';
    alertEl.innerHTML = '🚨 <strong>預算超支！</strong>本月 AI API 費用已超過 $' + BUDGET.monthlyLimit.toFixed(2) +
      ' 上限，目前累計 ' + fmtUsd(totalCost) + '。請立即檢查 API 使用量或調整配額。';
  } else if (usagePct >= BUDGET.warningThreshold * 100) {
    barEl.style.background = '#D4A574';
    alertEl.style.display = '';
    alertEl.className = 'budget-alert budget-warning';
    alertEl.innerHTML = '⚠️ <strong>預算警告</strong>：本月已使用 ' + barPct.toFixed(1) + '% 預算（' +
      fmtUsd(totalCost) + ' / $' + BUDGET.monthlyLimit.toFixed(2) + '），剩餘 ' + fmtUsd(remaining) + '。';
  } else {
    barEl.style.background = '#2A6B5E';
    alertEl.style.display = 'none';
  }
}

// ===== Match vs Chat 功能分離統計 =====
function renderFeatureBreakdown(totalData) {
  const matchCost = calcCost(totalData.match.inputTokens, totalData.match.outputTokens);
  const chatCost = calcCost(totalData.chat.inputTokens, totalData.chat.outputTokens);

  // Match 統計
  document.getElementById('matchCalls').textContent = fmtNum(totalData.match.calls);
  document.getElementById('matchTokens').textContent =
    fmtNum(totalData.match.inputTokens) + ' / ' + fmtNum(totalData.match.outputTokens);
  document.getElementById('matchCost').textContent = fmtUsd(matchCost);

  // Chat 統計
  document.getElementById('chatCalls').textContent = fmtNum(totalData.chat.calls);
  document.getElementById('chatTokens').textContent =
    fmtNum(totalData.chat.inputTokens) + ' / ' + fmtNum(totalData.chat.outputTokens);
  document.getElementById('chatCost').textContent = fmtUsd(chatCost);
}
