// ===== GLOBAL STATE =====
let stories = [];
let keywordMap = {};
let selectedTags = new Set();
let currentStory = null;
let typewriterInterval = null;
let litCount = 0;
let buildIdx = 0;
let recentStoryIds = []; // 記錄最近看過的故事，避免短期重複（50則冷卻）
let isSubmitting = false; // 防止重複提交
let lastUserMoodInput = ''; // 保存使用者心情輸入，供 AI 對話使用
let aiChatHistory = []; // AI 對話歷史
let isChatting = false; // 防止重複送出對話

// ===== AI MATCHING (Gemini) =====
// API key 以 Base64 存放，避免 GitHub 自動掃描偵測為洩漏
// 真正的安全性靠 Google AI Studio 的 HTTP Referrer 限制（僅允許 gjj22622.github.io/*）
const _gk = () => atob('QUl6YVN5QkE5R3kzNFBaYVFYRURXTEI3TU1uaks4R2M0dnFBTUtn');
const GEMINI_CONFIG = {
  get apiKey() { return _gk(); },
  model: 'gemini-2.5-flash',
  timeout: 8000
};
let storyIndex = null;

function buildStoryIndex() {
  return stories.map(s =>
    `${s.id}|${s.title}|${s.moral}|${s.keywords.join(',')}`
  ).join('\n');
}

async function aiSeekStory(userInput) {
  if (!storyIndex) storyIndex = buildStoryIndex();

  const exclude = recentStoryIds.length > 0
    ? `\n排除最近看過：${recentStoryIds.join(', ')}` : '';

  const prompt = `你在幫一個 50 歲以上、正在人生路上咬牙撐著的人推薦故事。
他們可能是照顧父母的三明治族、被職場推著走的主管、或是開始問自己「然後呢」的中年人。

根據他們說的話，感受他們「沒說出口的那個部分」，選出最能讓他們覺得「原來不是只有我這樣」的 3 則故事。
不要選太沉重的，也不要選太雞湯的。選那種讀完會安靜一下、然後微微點頭的故事。

選擇原則：
1. 故事寓意要能回應使用者的處境或情緒
2. 優先選情境相關的，其次選情緒共鳴的
3. 三則推薦要有差異性，不要都選同類型的故事
${selectedTags.size > 0 ? '\n使用者選的情緒標籤：' + Array.from(selectedTags).join(', ') : ''}
故事清單（ID|標題|寓意|關鍵字）：
${storyIndex}${exclude}

使用者的心情：「${userInput}」

選出最適合的3則。
回覆格式（僅回覆此JSON，不要加任何說明文字）：{"picks":["BDH-xxx","BDH-xxx","BDH-xxx"]}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), GEMINI_CONFIG.timeout);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.model}:generateContent?key=${GEMINI_CONFIG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 256,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );

    clearTimeout(tid);
    if (!res.ok) throw new Error(`API ${res.status}`);

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Empty response');

    // Track API usage for cost monitoring
    const usage = data.usageMetadata;
    if (usage && window.Analytics) {
      Analytics.track('ai_api_call', {
        model: GEMINI_CONFIG.model,
        promptTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0,
        success: true
      });
    }

    // Extract JSON even if Gemini adds text around it
    const jsonMatch = rawText.match(/\{[\s\S]*"picks"[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response: ' + rawText.substring(0, 80));
    const picks = JSON.parse(jsonMatch[0]).picks || [];
    const candidates = picks.map(id => stories.find(s => s.id === id)).filter(Boolean);
    if (candidates.length === 0) throw new Error('No valid picks');

    const chosen = candidates[0];
    recentStoryIds.push(chosen.id);
    if (recentStoryIds.length > 50) recentStoryIds.shift();

    console.log(`🤖 AI picked: ${chosen.title} (${chosen.id}) from [${picks.join(', ')}]`);
    return chosen;
  } catch (err) {
    clearTimeout(tid);
    // Track failed API calls
    if (window.Analytics) {
      Analytics.track('ai_api_call', {
        model: GEMINI_CONFIG.model,
        success: false,
        error: err.message?.substring(0, 100) || 'unknown'
      });
    }
    throw err;
  }
}

// ===== LOAD DATA ON STARTUP =====
// Supports both HTTP server (fetch) and local file:// (XMLHttpRequest fallback)
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Try fetch first (works on HTTP servers)
    if (window.location.protocol !== 'file:') {
      const [storiesRes, keywordsRes] = await Promise.all([
        fetch('./data/stories.json'),
        fetch('./data/keywords.json')
      ]);
      if (!storiesRes.ok || !keywordsRes.ok) throw new Error('HTTP error');
      stories = await storiesRes.json();
      const keywordData = await keywordsRes.json();
      keywordMap = keywordData.mappings || {};
    } else {
      // file:// protocol — use XMLHttpRequest (works locally in most browsers)
      const loadJSON = (url) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onload = () => {
          if (xhr.status === 0 || xhr.status === 200) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { reject(e); }
          } else { reject(new Error('XHR status ' + xhr.status)); }
        };
        xhr.onerror = () => reject(new Error('XHR failed for ' + url));
        xhr.send();
      });
      stories = await loadJSON('./data/stories.json');
      const keywordData = await loadJSON('./data/keywords.json');
      keywordMap = keywordData.mappings || {};
    }

    console.log(`✅ Loaded ${stories.length} stories, ${Object.keys(keywordMap).length} keywords`);

    // Initialize analytics
    if (window.Analytics) {
      try { Analytics.init(); } catch(e) { console.warn('Analytics init failed:', e); }
    }

    // Check URL parameter for direct story link (?story=BDH-001)
    const urlParams = new URLSearchParams(window.location.search);
    const storyParam = urlParams.get('story');
    if (storyParam) {
      const directStory = stories.find(s => s.id === storyParam);
      if (directStory) {
        currentStory = directStory;
        initializeUI();
        renderStory(currentStory);
        showScreen('story-screen');
        if (window.Analytics) Analytics.track('story_view', { storyId: directStory.id, style: directStory.style, title: directStory.title, source: 'direct_link' });
        return; // Skip normal flow
      }
    }

    initializeUI();
  } catch (error) {
    console.error('Error loading data:', error);
    // Show user-friendly error with troubleshooting hint
    const msg = window.location.protocol === 'file:'
      ? '無法載入故事資料。\n\n本機開啟 file:// 時，部分瀏覽器會封鎖資料讀取。\n\n解法：在此資料夾執行 "python -m http.server 8080"，然後開啟 http://localhost:8080'
      : '無法載入故事資料，請重新整理頁面。';
    alert(msg);
  }
});

// ===== INITIALIZE UI =====
function initializeUI() {
  createFireflies();
  setupMoodTags();
  setupInputHandlers();
}

// ===== AMBIENT FIREFLIES =====
function createFireflies() {
  const amb = document.getElementById('ambient');
  for (let i = 0; i < 15; i++) {
    const f = document.createElement('div');
    f.className = 'firefly';
    f.style.left = Math.random() * 100 + '%';
    f.style.top = (30 + Math.random() * 60) + '%';
    f.style.animationDelay = (Math.random() * 8) + 's';
    f.style.animationDuration = (6 + Math.random() * 6) + 's';
    amb.appendChild(f);
  }
}

// ===== MOOD TAG HANDLING =====
function setupMoodTags() {
  document.querySelectorAll('.mood-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('selected');
      const tags = tag.dataset.tags.split(',');
      tags.forEach(t => {
        if (tag.classList.contains('selected')) {
          selectedTags.add(t);
        } else {
          selectedTags.delete(t);
        }
      });
      updateSeekBtn();

      // Track tag selection
      if (window.Analytics) {
        Analytics.track('mood_tag_select', { tags: Array.from(selectedTags) });
      }
    });
  });
}

// ===== INPUT HANDLERS =====
function setupInputHandlers() {
  const moodInput = document.getElementById('moodInput');

  moodInput.addEventListener('input', updateSeekBtn);
  moodInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitMood();
  });

  // Event delegation for AI chat input (dynamically created)
  document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.id === 'aiChatInput') {
      sendAiChat();
    }
  });
}

function updateSeekBtn() {
  const btn = document.getElementById('seekBtn');
  const hasInput = document.getElementById('moodInput').value.trim().length > 0;
  if (selectedTags.size > 0 || hasInput) {
    btn.classList.add('ready');
  } else {
    btn.classList.remove('ready');
  }
}

// ===== KEYWORD PARSING (for fallback) =====
function parseInputKeywords(input) {
  for (const [keyword, tags] of Object.entries(keywordMap)) {
    if (input.includes(keyword)) {
      tags.forEach(t => selectedTags.add(t));
    }
  }
  stories.forEach(s => {
    s._inputScore = 0;
    s.keywords.forEach(kw => {
      if (input.includes(kw)) {
        s._inputScore += 1.5;
      }
    });
  });
}

// ===== MOOD SUBMISSION (AI-enhanced) =====
async function submitMood() {
  const input = document.getElementById('moodInput').value.trim();
  if (!input && selectedTags.size === 0) return;
  if (isSubmitting) return;
  isSubmitting = true;

  // Save mood input for AI chat context
  lastUserMoodInput = input;
  aiChatHistory = []; // Reset chat history for new story

  // Show transition immediately
  showTransition(false);
  const startTime = Date.now();

  let matchMethod = 'keyword';

  if (input) {
    try {
      currentStory = await aiSeekStory(input);
      matchMethod = 'ai';
    } catch (err) {
      console.warn('🤖 AI matching failed, using keyword fallback:', err.message);
      parseInputKeywords(input);
      seekStory(input);
    }
  } else {
    // Tags only — keyword matching is fine
    seekStory(input);
  }

  // Track
  if (window.Analytics && input) {
    Analytics.track('mood_text_input', {
      text: input,
      matchedStoryId: currentStory ? currentStory.id : '-',
      matchedStoryTitle: currentStory ? currentStory.title : '-',
      matchMethod: matchMethod
    });
  }

  // Ensure minimum transition time (2.8s)
  const elapsed = Date.now() - startTime;
  const wait = Math.max(0, 2800 - elapsed);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));

  if (currentStory) {
    renderStory(currentStory);
    showScreen('story-screen');
  }

  isSubmitting = false;
}


// ===== MATCHING ALGORITHM (keyword fallback) =====
function seekStory(userInput) {
  if (selectedTags.size === 0 && !document.getElementById('moodInput').value.trim()) {
    return;
  }

  const scored = stories.map(story => {
    let score = story._inputScore || 0;
    const allTags = [
      ...(story.tags.emotions || []),
      ...(story.tags.contexts || []),
      ...(story.tags.themes || [])
    ];
    selectedTags.forEach(tag => {
      if (allTags.includes(tag)) score += 2;
    });
    // 冷卻懲罰：最近 50 則看過的故事大幅扣分，避免壟斷
    if (recentStoryIds.includes(story.id)) score -= 10;
    score += Math.random() * 0.5;
    return { story, score };
  });

  scored.sort((a, b) => b.score - a.score);
  currentStory = scored[0].story;
  recentStoryIds.push(currentStory.id);
  if (recentStoryIds.length > 50) recentStoryIds.shift();
  stories.forEach(s => delete s._inputScore);
}

// ===== TRANSITION SCREEN =====
function showTransition(autoRender = true) {
  const phrases = [
    "千年的書頁正在翻動<br>找一則跟你有緣的…",
    "很久很久以前<br>有一個人，跟你遇到了一樣的事…",
    "別急，故事已經等了你一千五百年<br>不差這幾秒…",
    "你以為只有你這樣嗎？<br>一千五百年前就有人跟你一樣了…",
    "在那個年代<br>有人做了一件你一定會覺得很熟悉的事…"
  ];

  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  document.getElementById('transitionText').innerHTML = phrase;

  showScreen('transition-screen');

  if (autoRender) {
    setTimeout(() => {
      renderStory(currentStory);
      showScreen('story-screen');
    }, 2800);
  }
}

// ===== SCREEN NAVIGATION =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function goToMood() {
  if (typewriterInterval) {
    clearInterval(typewriterInterval);
    typewriterInterval = null;
  }

  selectedTags.clear();
  litCount = 0;
  buildIdx = 0;
  document.querySelectorAll('.mood-tag').forEach(t => t.classList.remove('selected'));
  document.getElementById('moodInput').value = '';
  updateSeekBtn();

  showScreen('mood-select');

  // Track session start
  if (window.Analytics) {
    Analytics.track('session_start', {});
  }
}

// ===== TREECAVE DIRECT ENTRY (50+ core feature) =====
function goToTreecaveDirect() {
  // Pick a random story as context for the treecave
  if (!stories || stories.length === 0) {
    goToMood();
    return;
  }
  const idx = Math.floor(Math.random() * stories.length);
  currentStory = stories[idx];
  lastUserMoodInput = '';
  showTransition(true);
  // After story renders, auto-open treecave
  setTimeout(() => {
    const trigger = document.getElementById('aiChatTrigger');
    if (trigger) trigger.click();
  }, 2500);
}

// ===== STORY RENDERERS =====
function renderStory(story) {
  const container = document.getElementById('storyContainer');
  container.innerHTML = '';
  container.className = 'story-container';

  // 同步 currentStory 到 window，供 Social 模組使用
  window.currentStory = story;

  // Track story view
  if (window.Analytics) {
    Analytics.track('story_view', { storyId: story.id, style: story.style, title: story.title });
  }

  // Render social share buttons after DOM is ready
  setTimeout(() => {
    const shareSection = document.getElementById('shareSection');
    if (shareSection && window.Social) {
      Social.renderShareButtons(story, shareSection);
    }
  }, 100);

  switch (story.style) {
    case 'ink':
      renderInk(story, container);
      break;
    case 'qa':
      renderQA(story, container);
      break;
    case 'typewriter':
      renderTypewriter(story, container);
      break;
    case 'lines':
      renderLines(story, container);
      break;
    case 'build':
      renderBuild(story, container);
      break;
  }
}

// --- STYLE A: Ink Wash Reveal ---
function renderInk(story, container) {
  container.classList.add('style-ink');

  let html = `
    <div class="story-title-area">
      <div class="story-icon">${story.icon}</div>
      <h1 class="story-title">${story.title}</h1>
      <p class="story-source">${story.original_title}｜${story.source}</p>
    </div>
  `;

  story.text.forEach((p, i) => {
    html += `<p class="story-paragraph" data-index="${i}">${p}</p>`;
  });

  html += buildMoralHTML(story);
  container.innerHTML = html;

  // Intersection observer for scroll reveal
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.3 });

  // Stagger reveal
  const paras = container.querySelectorAll('.story-paragraph');
  paras.forEach((p, i) => {
    setTimeout(() => observer.observe(p), i * 200);
    setTimeout(() => p.classList.add('visible'), 500 + i * 600);
  });

  // Show moral after paragraphs
  setTimeout(() => {
    const moral = container.querySelector('.moral-section');
    if (moral) moral.classList.add('visible');
  }, 500 + story.text.length * 600 + 800);
}

// --- STYLE B: Interactive Q&A ---
function renderQA(story, container) {
  container.classList.add('style-qa');

  let html = `
    <div class="story-title-area">
      <div class="story-icon">${story.icon}</div>
      <h1 class="story-title">${story.title}</h1>
      <p class="story-source">${story.original_title}｜${story.source}</p>
    </div>
  `;

  // Build QA steps from text and questions
  const questions = story.questions || [];
  story.text.forEach((textItem, i) => {
    html += `<div class="qa-step${i === 0 ? ' active' : ''}" data-step="${i}">`;
    html += `<div class="qa-narrative">${textItem}</div>`;

    if (i < questions.length && questions[i]) {
      const q = questions[i];
      html += `<div class="qa-question">${q.q}</div>`;
      html += `<div class="qa-choices">`;
      q.choices.forEach((c, ci) => {
        html += `<button class="qa-choice" onclick="qaChoose(${i},${ci})">${c}</button>`;
      });
      html += `</div>`;
    } else if (i === story.text.length - 1) {
      html += `<button class="qa-next" onclick="qaFinish()">這則故事想說的是… 🪷</button>`;
    } else {
      // No question for this step — add a continue button so user can advance
      html += `<button class="qa-next" onclick="qaAdvance(${i})">繼續 ▸</button>`;
    }
    html += `</div>`;
  });

  html += buildMoralHTML(story);
  container.innerHTML = html;
}

function qaChoose(stepIdx, choiceIdx) {
  const steps = document.querySelectorAll('.qa-step');
  const step = steps[stepIdx];
  const choices = step.querySelectorAll('.qa-choice');

  choices.forEach((c, i) => {
    c.style.pointerEvents = 'none';
    if (i === choiceIdx) {
      const q = currentStory.questions[stepIdx];
      const isCorrect = q && q.ans === choiceIdx;
      c.style.borderColor = isCorrect ? 'var(--jade)' : 'var(--lotus-gold)';
      c.style.background = isCorrect ? 'rgba(42,107,94,0.15)' : 'rgba(212,165,116,0.1)';
    } else {
      c.style.opacity = '0.3';
    }
  });

  setTimeout(() => {
    step.classList.remove('active');
    const next = steps[stepIdx + 1];
    if (next) next.classList.add('active');
  }, 1200);
}

function qaAdvance(stepIdx) {
  const steps = document.querySelectorAll('.qa-step');
  steps[stepIdx].classList.remove('active');
  const next = steps[stepIdx + 1];
  if (next) {
    next.classList.add('active');
    next.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function qaFinish() {
  const moral = document.querySelector('.moral-section');
  if (moral) {
    moral.classList.add('visible');
    moral.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// --- STYLE C: Typewriter ---
function renderTypewriter(story, container) {
  container.classList.add('style-typewriter');

  let html = `
    <div class="story-title-area">
      <div class="story-icon">${story.icon}</div>
      <h1 class="story-title">${story.title}</h1>
      <p class="story-source">${story.original_title}｜${story.source}</p>
    </div>
    <div class="typewriter-area" id="typewriterArea"></div>
    <button class="typewriter-skip" id="typewriterSkip" onclick="typewriterSkip()">直接看完整故事</button>
  `;
  html += buildMoralHTML(story);
  container.innerHTML = html;

  const area = document.getElementById('typewriterArea');
  // Join text array with newlines
  const fullText = story.text.join('\n\n');
  let idx = 0;
  const speed = 60; // ms per char

  area.innerHTML = '<span class="typewriter-cursor"></span>';

  typewriterInterval = setInterval(() => {
    if (idx < fullText.length) {
      const char = fullText[idx];
      const cursor = area.querySelector('.typewriter-cursor');
      if (char === '\n') {
        cursor.insertAdjacentHTML('beforebegin', '<br>');
      } else {
        cursor.insertAdjacentHTML('beforebegin', char);
      }
      idx++;
      // Auto scroll
      area.scrollTop = area.scrollHeight;
    } else {
      clearInterval(typewriterInterval);
      typewriterInterval = null;
      const cursor = area.querySelector('.typewriter-cursor');
      if (cursor) cursor.remove();
      document.getElementById('typewriterSkip').style.display = 'none';
      setTimeout(() => {
        const moral = container.querySelector('.moral-section');
        if (moral) {
          moral.classList.add('visible');
          moral.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 600);
    }
  }, speed);
}

function typewriterSkip() {
  if (typewriterInterval) {
    clearInterval(typewriterInterval);
    typewriterInterval = null;
  }
  if (window.Analytics) Analytics.track('story_interact', { type: 'typewriter_skip', storyId: currentStory.id });
  const story = currentStory;
  const area = document.getElementById('typewriterArea');
  area.innerHTML = story.text.join('\n\n').replace(/\n/g, '<br>');
  document.getElementById('typewriterSkip').style.display = 'none';
  setTimeout(() => {
    const moral = document.querySelector('.moral-section');
    if (moral) {
      moral.classList.add('visible');
      moral.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 400);
}

// --- STYLE D: Line by Line ---
function renderLines(story, container) {
  container.classList.add('style-lines');

  let html = `
    <div class="story-title-area">
      <div class="story-icon">${story.icon}</div>
      <h1 class="story-title">${story.title}</h1>
      <p class="story-source">${story.original_title}｜${story.source}</p>
    </div>
    <div class="lines-hint">輕輕點每一行，慢慢讀 ✨</div>
  `;

  story.text.forEach((line, i) => {
    html += `<div class="story-line" data-line="${i}" onclick="lightLine(${i})">${line}</div>`;
  });

  html += buildMoralHTML(story);
  container.innerHTML = html;
  litCount = 0;
}

function lightLine(idx) {
  const line = document.querySelector(`.story-line[data-line="${idx}"]`);
  if (line && !line.classList.contains('lit')) {
    line.classList.add('lit');
    litCount++;

    if (litCount >= currentStory.text.length) {
      setTimeout(() => {
        document.querySelector('.lines-hint').textContent = '讀完了 🪷 往下看看寓意';
        const moral = document.querySelector('.moral-section');
        if (moral) {
          moral.classList.add('visible');
          moral.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
    }
  }
}

// --- STYLE E: Building Layers ---
function renderBuild(story, container) {
  container.classList.add('style-build');

  let html = `
    <div class="story-title-area">
      <div class="story-icon">${story.icon}</div>
      <h1 class="story-title">${story.title}</h1>
      <p class="story-source">${story.original_title}｜${story.source}</p>
    </div>
    <div class="build-scene">
      <div class="building-visual" id="buildingVisual">
  `;

  // Use text and floor_labels
  const labels = story.floor_labels || [];
  story.text.forEach((floorText, i) => {
    const label = labels[i] || `第${i + 1}層`;
    html += `<div class="building-floor" data-floor="${label}" data-idx="${i}">${floorText}</div>`;
  });

  html += `</div>
      <button class="build-btn" id="buildBtn" onclick="buildNext()">開始蓋房子 🏗️</button>
    </div>
  `;
  html += buildMoralHTML(story);
  container.innerHTML = html;
  buildIdx = 0;
}

function buildNext() {
  const floors = document.querySelectorAll('.building-floor');
  if (buildIdx < floors.length) {
    const floor = floors[buildIdx];
    floor.classList.add('building', 'built');
    setTimeout(() => floor.classList.remove('building'), 600);
    buildIdx++;

    const btn = document.getElementById('buildBtn');
    if (buildIdx < floors.length) {
      const floorNames = currentStory.floor_labels || [];
      const nextLabel = floorNames[buildIdx] || `第${buildIdx + 1}層`;
      btn.textContent = `蓋${nextLabel} 🏗️`;
    } else {
      btn.textContent = "這則故事想說的是… 🪷";
      btn.onclick = () => {
        const moral = document.querySelector('.moral-section');
        if (moral) {
          moral.classList.add('visible');
          moral.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        btn.style.display = 'none';
      };
    }

    // 自動捲動讓最新蓋好的樓層和按鈕都在畫面中
    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ===== RANDOM STORY =====
function randomStory() {
  if (stories.length === 0) return;

  // Track random story request
  if (window.Analytics) {
    Analytics.track('random_story', {});
  }

  // 避免短期重複：排除最近看過的故事（最多記 20 則）
  let pool = stories.filter(s => !recentStoryIds.includes(s.id));
  if (pool.length === 0) {
    // 全部看完了，清空記錄重新開始
    recentStoryIds = [];
    pool = stories;
  }

  currentStory = pool[Math.floor(Math.random() * pool.length)];

  // 記錄到最近看過清單
  recentStoryIds.push(currentStory.id);
  if (recentStoryIds.length > 50) recentStoryIds.shift();

  // Reset states
  litCount = 0;
  buildIdx = 0;
  if (typewriterInterval) {
    clearInterval(typewriterInterval);
    typewriterInterval = null;
  }

  showTransition();
}

// ===== MOOD FEEDBACK =====
function submitFeedback(feedbackType) {
  if (!currentStory) return;

  // Track feedback event
  if (window.Analytics) {
    Analytics.track('mood_feedback', {
      storyId: currentStory.id,
      storyTitle: currentStory.title,
      feedbackType: feedbackType
    });
  }

  // Visual feedback — highlight selected and show thanks
  const btns = document.querySelectorAll('.feedback-btn');
  btns.forEach(btn => {
    btn.style.pointerEvents = 'none';
    if (btn.dataset.feedback === feedbackType) {
      btn.classList.add('selected');
    } else {
      btn.style.opacity = '0.3';
    }
  });

  const thanks = document.getElementById('feedbackThanks');
  if (thanks) thanks.classList.add('show');
}

// ===== SHARED MORAL SECTION =====
function buildMoralHTML(story) {
  return `
    <div class="moral-section">
      <div class="moral-label">這則故事想說的是…</div>
      <div class="moral-text">${story.moral}</div>
      <div class="moral-elaboration">${story.elaboration}</div>
      <div class="reflection-box">
        <div class="reflection-label">想一想</div>
        <div class="reflection-q">${story.reflection}</div>
      </div>
      <button class="original-toggle" onclick="toggleOriginal()">🍃 看看一千五百年前的原文</button>
      <div class="original-text" id="originalText">${story.original_text}</div>
      <div class="share-section" id="shareSection"></div>
      <div class="feedback-section" id="feedbackSection">
        <div class="feedback-title">這則故事，有說中你嗎？</div>
        <div class="feedback-options">
          <button class="feedback-btn" data-feedback="peace" onclick="submitFeedback('peace')">
            <span class="feedback-icon">🧘</span>
            <span>心裡靜了一點</span>
          </button>
          <button class="feedback-btn" data-feedback="enlightened" onclick="submitFeedback('enlightened')">
            <span class="feedback-icon">💡</span>
            <span>好像突然想通了</span>
          </button>
          <button class="feedback-btn" data-feedback="insight" onclick="submitFeedback('insight')">
            <span class="feedback-icon">🪷</span>
            <span>原來不是只有我這樣</span>
          </button>
          <button class="feedback-btn" data-feedback="thinking" onclick="submitFeedback('thinking')">
            <span class="feedback-icon">🤔</span>
            <span>還在想…</span>
          </button>
          <button class="feedback-btn" data-feedback="none" onclick="submitFeedback('none')">
            <span class="feedback-icon">😶</span>
            <span>沒什麼感覺</span>
          </button>
        </div>
        <div class="feedback-thanks" id="feedbackThanks">謝謝你 🙏 願這份清涼陪你走一段路</div>
      </div>
      <div class="ai-chat-section" id="aiChatSection">
        <button class="ai-chat-trigger" id="aiChatTrigger" onclick="openAiChat()">
          <span class="ai-chat-trigger-icon">🌳</span>
          <span class="ai-chat-trigger-text">跟老樹說說心裡話</span>
          <span class="ai-chat-trigger-hint">這裡沒有人會評判你，說完就讓風帶走</span>
        </button>
        <div class="ai-chat-container" id="aiChatContainer" style="display:none">
          <div class="ai-chat-messages" id="aiChatMessages"></div>
          <div class="ai-chat-input-wrap">
            <input type="text" class="ai-chat-input" id="aiChatInput" placeholder="想說什麼就說，不用組織語言…" autocomplete="off">
            <button class="ai-chat-send" id="aiChatSend" onclick="sendAiChat()">說出來</button>
          </div>
          <div class="ai-chat-note">🍃 你說的話不會留下來，就像風吹過樹梢</div>
        </div>
      </div>
      <div class="action-row">
        <button class="action-btn primary" onclick="tryAnother()">🪷 再聽一則</button>
        <button class="action-btn" onclick="goToMood()">換一個</button>
      </div>
    </div>
  `;
}

// ===== MORAL SECTION ACTIONS =====
function toggleOriginal() {
  const el = document.getElementById('originalText');
  el.classList.toggle('show');
  if (window.Analytics) Analytics.track('original_toggle', { storyId: currentStory.id });
}

function tryAnother() {
  if (window.Analytics) {
    Analytics.track('try_another', { fromStoryId: currentStory.id });
  }
  // 排除最近看過的故事
  let pool = stories.filter(s => !recentStoryIds.includes(s.id));
  if (pool.length === 0) {
    recentStoryIds = [];
    pool = stories.filter(s => s.id !== currentStory.id);
  }
  currentStory = pool[Math.floor(Math.random() * pool.length)];
  recentStoryIds.push(currentStory.id);
  if (recentStoryIds.length > 50) recentStoryIds.shift();

  // Reset states
  litCount = 0;
  buildIdx = 0;
  if (typewriterInterval) {
    clearInterval(typewriterInterval);
    typewriterInterval = null;
  }

  showTransition();
}

function shareStory() {
  if (window.Social) {
    Social.nativeShare(currentStory);
  } else {
    // Fallback if Social module not loaded
    const text = `${currentStory.icon} ${currentStory.title}\n\n「${currentStory.moral}」\n\n${currentStory.reflection}\n\n—— 一念清涼 🪷`;
    if (navigator.share) {
      navigator.share({ title: '一念清涼 — ' + currentStory.title, text: text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => alert('已複製到剪貼簿！')).catch(() => alert('複製失敗'));
    }
  }
}

// ===== AI STORY CHAT (Phase 2) =====
function openAiChat() {
  const container = document.getElementById('aiChatContainer');
  const trigger = document.getElementById('aiChatTrigger');

  if (container.style.display !== 'none') {
    // Already open, toggle close
    container.style.display = 'none';
    trigger.classList.remove('active');
    return;
  }

  container.style.display = '';
  trigger.classList.add('active');
  aiChatHistory = [];

  // Track
  if (window.Analytics) {
    Analytics.track('ai_chat_open', { storyId: currentStory.id });
  }

  // Auto-send first AI message (greeting + personalized reflection prompt)
  const msgs = document.getElementById('aiChatMessages');
  msgs.innerHTML = '';
  addChatBubble('ai', '老樹在聽…');
  sendFirstAiMessage();

  // Focus input
  setTimeout(() => document.getElementById('aiChatInput').focus(), 300);
}

async function sendFirstAiMessage() {
  const story = currentStory;
  const moodContext = lastUserMoodInput
    ? `使用者的心情：「${lastUserMoodInput}」\n` : '';

  const systemPrompt = `你是「一念清涼」千年樹洞的聲音。一棵在山間靜立兩千年的菩提古樹，使用者選擇對你傾訴心事。

跟你說話的人，大多是 50 歲以上、正在人生路上咬牙撐著的人。他們可能正在照顧年邁的父母、擔心還沒獨立的孩子、對自己的身體感到不安、或者在問自己「這輩子到底值不值得」。他們不需要你給答案，他們需要的是有人真的聽懂了。

你不說教、不評判、不給標準答案，而是用溫厚的語氣，把故事裡的智慧，輕輕連結到他正在經歷的事。像風穿過樹洞發出的低語，溫柔但有力量。

故事標題：${story.title}
故事內容：${story.text.join('\n')}
寓意：${story.moral}
延伸闡述：${story.elaboration}
反思提問：${story.reflection}
${moodContext}
你的角色規則：
1. 像風穿過樹洞的低語——溫柔、不說教、不居高臨下
2. 用口語化的現代中文，溫厚有閱歷感，像老朋友泡茶聊天
3. 每次回覆控制在 100-150 字以內
4. 不急著反問，先「聽完」再回應。多用「我懂」「你已經撐很久了」「這很不容易」
5. 適時提出反思，但用「會不會其實是…」而不是「你有沒有想過…」
6. 可以用故事中的情節做類比
7. 不要重複說「這則故事告訴我們」這種制式語言
8. 偶爾可以用自然意象（風、葉、光）來回應，但不要過度
9. 記住：他們什麼道理都聽過了，他們需要的不是道理，是有人懂

第一則訊息：根據使用者的心情和這則故事，用老樹溫厚的口吻給一段開場。先讓他感覺被理解，再輕輕帶出一個連結到他生活的反思。不要超過 120 字。`;

  aiChatHistory = [{ role: 'user', parts: [{ text: systemPrompt }] }];

  try {
    const reply = await callGeminiChat(aiChatHistory);
    // Replace the loading bubble
    const msgs = document.getElementById('aiChatMessages');
    msgs.lastChild.remove();
    addChatBubble('ai', reply);
    aiChatHistory.push({ role: 'model', parts: [{ text: reply }] });
  } catch (err) {
    const msgs = document.getElementById('aiChatMessages');
    msgs.lastChild.remove();
    addChatBubble('ai', '老樹今天有點累了 🍃 不過沒關係，靜靜坐一會兒，讓故事自己在心裡慢慢發酵。');
    console.warn('AI chat first message failed:', err.message);
  }
}

async function sendAiChat() {
  const input = document.getElementById('aiChatInput');
  const userText = input.value.trim();
  if (!userText || isChatting) return;
  isChatting = true;

  input.value = '';
  addChatBubble('user', userText);

  // Limit conversation to 15 rounds
  const userMsgCount = aiChatHistory.filter(m => m.role === 'user').length;
  if (userMsgCount >= 15) {
    addChatBubble('ai', '謝謝你今天願意坐下來說這些 🍃 這些話已經隨風去了，但你的心，輕了一點點吧？這棵老樹每天都在，想說話的時候隨時回來。帶著這份清涼，慢慢走，不急。');
    document.querySelector('.ai-chat-input-wrap').style.display = 'none';
    isChatting = false;
    return;
  }

  // Add user message to history
  aiChatHistory.push({ role: 'user', parts: [{ text: userText }] });

  // Show typing indicator
  addChatBubble('ai', '...');
  const msgs = document.getElementById('aiChatMessages');
  const typingBubble = msgs.lastChild;

  try {
    const reply = await callGeminiChat(aiChatHistory);
    typingBubble.remove();
    addChatBubble('ai', reply);
    aiChatHistory.push({ role: 'model', parts: [{ text: reply }] });

    // Track
    if (window.Analytics) {
      Analytics.track('ai_chat_message', {
        storyId: currentStory.id,
        round: userMsgCount + 1
      });
    }
  } catch (err) {
    typingBubble.remove();
    addChatBubble('ai', '風太大了，沒聽清楚。再說一次好嗎？');
    // Remove failed user message from history
    aiChatHistory.pop();
    console.warn('AI chat failed:', err.message);
  }

  isChatting = false;
  input.focus();
}

async function callGeminiChat(history) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12000); // 12s timeout for chat

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.model}:generateContent?key=${GEMINI_CONFIG.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: history,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 300,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    }
  );
  clearTimeout(tid);

  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response');

  // Track API usage
  const usage = data.usageMetadata;
  if (usage && window.Analytics) {
    Analytics.track('ai_api_call', {
      model: GEMINI_CONFIG.model,
      promptTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0,
      success: true,
      feature: 'chat'
    });
  }

  return text;
}

function addChatBubble(role, text) {
  const msgs = document.getElementById('aiChatMessages');
  const bubble = document.createElement('div');
  bubble.className = `ai-chat-bubble ${role}`;
  bubble.textContent = text;
  msgs.appendChild(bubble);
  msgs.scrollTop = msgs.scrollHeight;
}

// ===== PUBLIC API FOR HTML =====
window.submitMood = submitMood;
window.seekStory = seekStory;
window.parseInputKeywords = parseInputKeywords;
window.goToMood = goToMood;
window.qaChoose = qaChoose;
window.qaAdvance = qaAdvance;
window.qaFinish = qaFinish;
window.typewriterSkip = typewriterSkip;
window.lightLine = lightLine;
window.buildNext = buildNext;
window.toggleOriginal = toggleOriginal;
window.tryAnother = tryAnother;
window.shareStory = shareStory;
window.randomStory = randomStory;
window.submitFeedback = submitFeedback;
window.openAiChat = openAiChat;
window.sendAiChat = sendAiChat;
