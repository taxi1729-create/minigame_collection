// actions/flash-draw.js - 5秒消え絵
// フロー：描く → 完成ボタン → 次の人に渡す画面 → 準備完了ボタン → 絵が出現 → 5秒で左ワイプ消え

function renderFlashDrawAction(container, topic, prevRecord, onComplete, onReselect) {
  const prevHtml = prevRecord
    ? (typeof buildPrevContentHtml === 'function' ? buildPrevContentHtml(prevRecord) : '')
    : '';

  container.innerHTML = `
    <div class="action-container drawing-action">
      <h2 class="action-title">⚡ 5秒消え絵</h2>
      ${prevHtml}
      <div class="current-topic-display">
        <span class="current-topic-label">あなたの修飾語</span>
        <span class="current-topic-value">${topic}</span>
      </div>
      <p class="action-desc-text">
        絵を描いて次の人に渡します。<br>
        次の人が「準備完了」を押した瞬間から絵が現れ、<strong>5秒で左から消えます</strong>。
      </p>

      <div class="drawing-toolbar">
        <div class="tool-group">
          <button class="tool-btn active" id="toolPen" title="ペン">✏️</button>
          <button class="tool-btn" id="toolEraser" title="消しゴム">🧹</button>
        </div>
        <div class="tool-group size-group">
          <button class="size-btn active" data-size="4">細</button>
          <button class="size-btn" data-size="10">中</button>
          <button class="size-btn" data-size="20">太</button>
        </div>
        <div class="tool-group">
          <input type="color" id="colorPicker" value="#222222" title="色">
        </div>
        <button class="tool-btn danger" id="clearBtn" title="全消去">🗑️</button>
      </div>

      <canvas id="drawCanvas" class="draw-canvas"></canvas>

      <button class="btn btn-primary" id="flashDoneBtn">完成！次の人へ渡す ▶</button>
      <button class="btn btn-reselect" id="flashReselectBtn">↩ アクションを選び直す</button>
    </div>
  `;

  initDrawCanvas('drawCanvas');

  document.getElementById('flashDoneBtn').onclick = () => {
    const canvas = document.getElementById('drawCanvas');
    const imageData = canvas.toDataURL('image/png');
    // 「次の人に渡す」中間画面へ
    renderFlashDrawHandoff(container, imageData, onComplete);
  };
  document.getElementById('flashReselectBtn').onclick = onReselect;
}

// ===== 中間画面：次の人に端末を渡してから準備完了を押してもらう =====
function renderFlashDrawHandoff(container, imageData, onComplete) {
  container.innerHTML = `
    <div class="action-container">
      <h2 class="action-title">⚡ 次の人へ渡してください</h2>
      <div class="private-warning">📵 次の人以外は画面を見ないでください</div>
      <p class="action-desc-text">
        次の人が準備できたら「準備完了」を押してください。<br>
        ボタンを押した瞬間に絵が現れ、<strong>5秒で消えます</strong>！
      </p>
      <button class="btn btn-primary" id="flashReadyBtn">準備完了 → 絵を見る ▶</button>
    </div>
  `;

  document.getElementById('flashReadyBtn').onclick = () => {
    renderFlashDrawViewer(container, imageData, onComplete);
  };
}

// ===== 視聴画面：絵が出現して5秒で左ワイプ消え =====
function renderFlashDrawViewer(container, imageData, onComplete) {
  container.innerHTML = `
    <div class="action-container">
      <h2 class="action-title">⚡ 5秒で消えます！</h2>
      <p class="action-desc-text">今すぐ見てください！左から消えていきます！</p>
      <div class="flash-result-wrap">
        <img id="flashImg" src="${imageData}" class="result-drawing flash-wipe-img" alt="絵">
        <div id="flashTimer" class="flash-timer-overlay">5</div>
      </div>
      <button class="btn btn-primary" id="flashNextBtn" style="display:none;">アクションを選ぶ ▶</button>
    </div>
  `;

  // カウントダウン表示
  let remaining = 5;
  const timerEl = document.getElementById('flashTimer');
  const countTick = setInterval(() => {
    remaining--;
    if (timerEl) timerEl.textContent = remaining > 0 ? remaining : '';
    SoundManager && SoundManager.playCountdown && SoundManager.playCountdown();
    if (remaining <= 0) clearInterval(countTick);
  }, 1000);

  // 左ワイプ開始
  startFlashWipe('flashImg', null, 5, () => {
    if (timerEl) timerEl.style.display = 'none';
    clearInterval(countTick);
    const btn = document.getElementById('flashNextBtn');
    if (btn) btn.style.display = 'block';
  });

  document.getElementById('flashNextBtn').onclick = () => onComplete({ imageData });
}

// ===== 共通：左ワイプ関数（clip-path で左から削る） =====
function startFlashWipe(imgId, _timerIdUnused, seconds, onDone) {
  const img = document.getElementById(imgId);
  if (!img) return;
  img.style.clipPath  = 'inset(0 0% 0 0)';
  img.style.transition = `clip-path ${seconds}s linear`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    img.style.clipPath = 'inset(0 0% 0 100%)';
  }));
  setTimeout(() => onDone && onDone(), seconds * 1000 + 100);
}

// ===== リザルト用：要素を直接受け取ってワイプ =====
function startFlashWipeOnElement(imgEl, seconds, onDone) {
  if (!imgEl) return;
  imgEl.style.clipPath  = 'inset(0 0% 0 0)';
  imgEl.style.transition = `clip-path ${seconds}s linear`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    imgEl.style.clipPath = 'inset(0 0% 0 100%)';
  }));
  setTimeout(() => onDone && onDone(), seconds * 1000 + 100);
}
