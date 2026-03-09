// ===== GLOBAL STATE =====
let stories = [];
let keywordMap = {};
let selectedTags = new Set();
let currentStory = null;
let typewriterInterval = null;
let litCount = 0;
let buildIdx = 0;

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

// ===== MOOD SUBMISSION =====
function submitMood() {
  const input = document.getElementById('moodInput').value.trim();
  if (!input && selectedTags.size === 0) return;

  // Parse input into tags using keyword map
  if (input) {
    for (const [keyword, tags] of Object.entries(keywordMap)) {
      if (input.includes(keyword)) {
        tags.forEach(t => selectedTags.add(t));
      }
    }

    // Also score stories based on direct keyword match
    stories.forEach(s => {
      s._inputScore = 0;
      s.keywords.forEach(kw => {
        if (input.includes(kw)) {
          s._inputScore += 1.5; // 降低權重，避免單一故事因 keyword 獨佔常見詞而壟斷
        }
      });
    });
  }

  seekStory(input);
}


// ===== MATCHING ALGORITHM =====
function seekStory(userInput) {
  if (selectedTags.size === 0 && !document.getElementById('moodInput').value.trim()) {
    return;
  }

  // Score each story
  const scored = stories.map(story => {
    let score = story._inputScore || 0;

    // Combine all tags from the new JSON structure
    const allTags = [
      ...(story.tags.emotions || []),
      ...(story.tags.contexts || []),
      ...(story.tags.themes || [])
    ];

    // Add score for matching selected tags
    selectedTags.forEach(tag => {
      if (allTags.includes(tag)) {
        score += 2;
      }
    });

    // Add slight randomness to avoid always same result
    score += Math.random() * 0.5;

    return { story, score };
  });

  scored.sort((a, b) => b.score - a.score);
  currentStory = scored[0].story;

  // Clean up
  stories.forEach(s => delete s._inputScore);

  // Track text input WITH matched story (after matching)
  if (window.Analytics && userInput) {
    Analytics.track('mood_text_input', {
      text: userInput,
      matchedStoryId: currentStory.id,
      matchedStoryTitle: currentStory.title
    });
  }

  // Show transition
  showTransition();
}

// ===== TRANSITION SCREEN =====
function showTransition() {
  const phrases = [
    "正在千年智慧中<br>為你尋找一念清涼…",
    "翻開兩千年前的經卷<br>尋找屬於你的那一頁…",
    "在古老的寓言裡<br>有一則故事正等著你…",
    "讓時光倒流一千五百年<br>那裡有人也曾和你一樣…"
  ];

  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  document.getElementById('transitionText').innerHTML = phrase;

  showScreen('transition-screen');

  setTimeout(() => {
    renderStory(currentStory);
    showScreen('story-screen');
  }, 2800);
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
      html += `<button class="qa-next" onclick="qaFinish()">看見寓意 🪷</button>`;
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
    <button class="typewriter-skip" id="typewriterSkip" onclick="typewriterSkip()">跳過打字效果</button>
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
    <div class="lines-hint">點擊每一行，點亮故事 ✨</div>
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
        document.querySelector('.lines-hint').textContent = '故事讀完了 🪷';
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
      const labels = ["繼續往上蓋", "蓋第二層", "蓋最後一層"];
      btn.textContent = (labels[buildIdx - 1] || "繼續") + " 🏗️";
    } else {
      btn.textContent = "看見寓意 🪷";
      btn.onclick = () => {
        const moral = document.querySelector('.moral-section');
        if (moral) {
          moral.classList.add('visible');
          moral.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        btn.style.display = 'none';
      };
    }

    floor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ===== RANDOM STORY =====
function randomStory() {
  if (stories.length === 0) return;

  // Track random story request
  if (window.Analytics) {
    Analytics.track('random_story', {});
  }

  // Pick a truly random story
  currentStory = stories[Math.floor(Math.random() * stories.length)];

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
      <div class="moral-label">一念清涼 ── 寓意</div>
      <div class="moral-text">${story.moral}</div>
      <div class="moral-elaboration">${story.elaboration}</div>
      <div class="reflection-box">
        <div class="reflection-label">今日一問</div>
        <div class="reflection-q">${story.reflection}</div>
      </div>
      <button class="original-toggle" onclick="toggleOriginal()">📜 查看原典文言文</button>
      <div class="original-text" id="originalText">${story.original_text}</div>
      <div class="share-section" id="shareSection"></div>
      <div class="feedback-section" id="feedbackSection">
        <div class="feedback-title">讀完這則故事，你的感受是？</div>
        <div class="feedback-subtitle">你的回饋將幫助我們為更多人帶來一念清涼</div>
        <div class="feedback-options">
          <button class="feedback-btn" data-feedback="peace" onclick="submitFeedback('peace')">
            <span class="feedback-icon">🧘</span>
            <span>感到平靜</span>
          </button>
          <button class="feedback-btn" data-feedback="enlightened" onclick="submitFeedback('enlightened')">
            <span class="feedback-icon">💡</span>
            <span>得到開示</span>
          </button>
          <button class="feedback-btn" data-feedback="insight" onclick="submitFeedback('insight')">
            <span class="feedback-icon">🪷</span>
            <span>有所體悟</span>
          </button>
          <button class="feedback-btn" data-feedback="thinking" onclick="submitFeedback('thinking')">
            <span class="feedback-icon">🤔</span>
            <span>仍在思考</span>
          </button>
        </div>
        <div class="feedback-thanks" id="feedbackThanks">感謝你的回饋 🙏 願你帶著這份清涼前行</div>
      </div>
      <div class="action-row">
        <button class="action-btn primary" onclick="tryAnother()">🪷 再抽一則</button>
        <button class="action-btn" onclick="goToMood()">換個心情</button>
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
  // Pick a different story randomly
  const others = stories.filter(s => s.id !== currentStory.id);
  currentStory = others[Math.floor(Math.random() * others.length)];

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

// ===== PUBLIC API FOR HTML =====
window.submitMood = submitMood;
window.seekStory = seekStory;
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
