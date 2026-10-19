// actions/drawing.js - お絵描きアクション（お邪魔虫 bug.png：固定配置・動かない）

function renderDrawingAction(container, topic, prevRecord, onComplete, onReselect) {
  const prevHtml = prevRecord
    ? (typeof buildPrevContentHtml === 'function' ? buildPrevContentHtml(prevRecord) : '')
    : '';

  container.innerHTML = `
    <div class="action-container drawing-action">
      <h2 class="action-title">🎨 絵を描く</h2>
      ${prevHtml}
      <div class="current-topic-display">
        <span class="current-topic-label">あなたの修飾語</span>
        <span class="current-topic-value">${topic}</span>
      </div>

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
      <p class="action-desc-text" style="font-size:0.75rem;">
        ※ 完成後、次の人が見る時にお邪魔虫が絵の上に固定配置されます！
      </p>

      <button class="btn btn-primary" id="drawDoneBtn">完成！次の人へ渡す ▶</button>
      <button class="btn btn-reselect" id="drawReselectBtn">↩ アクションを選び直す</button>
    </div>
  `;

  initDrawCanvas('drawCanvas');

  document.getElementById('drawDoneBtn').onclick = () => {
    const canvas = document.getElementById('drawCanvas');
    const imageData = canvas.toDataURL('image/png');
    const bugPositions = generateBugPositions(3);
    // ★ 中間画面：次の人に端末を渡してから絵を表示する
    renderDrawingHandoff(container, imageData, bugPositions, onComplete);
  };

  document.getElementById('drawReselectBtn').onclick = onReselect;
}

// ===== お邪魔虫の固定座標を生成（描画完了時に一度だけ決める） =====
function generateBugPositions(count) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      leftPct: 5 + Math.random() * 70,  // 5%〜75% の範囲
      topPct:  5 + Math.random() * 70,  // 5%〜75% の範囲
      rotate:  Math.floor(Math.random() * 360)
    });
  }
  return positions;
}

// ===== 中間画面：次の人に端末を渡す =====
function renderDrawingHandoff(container, imageData, bugPositions, onComplete) {
  container.innerHTML = `
    <div class="action-container">
      <h2 class="action-title">🎨 次の人へ渡してください</h2>
      <div class="private-warning">📵 次の人以外は画面を見ないでください</div>
      <p class="action-desc-text">
        次の人が準備できたら「絵を見る」を押してください。<br>
        お邪魔虫が絵の上に現れます！
      </p>
      <button class="btn btn-primary" id="drawHandoffBtn">準備完了 → 絵を見る ▶</button>
    </div>
  `;
  document.getElementById('drawHandoffBtn').onclick = () => {
    renderDrawingWithBug(container, imageData, bugPositions, onComplete);
  };
}

// ===== 次の人に見せる：お邪魔虫固定オーバーレイ =====
// bugPositions は generateBugPositions() の結果。毎回同じ座標で表示する。
function renderDrawingWithBug(container, imageData, bugPositions, onComplete) {
  const bugsHtml = bugPositions.map(p => `
    <img src="bug.png"
      class="ojama-bug"
      style="left:${p.leftPct}%;top:${p.topPct}%;transform:rotate(${p.rotate}deg);"
      alt="お邪魔虫">
  `).join('');

  container.innerHTML = `
    <div class="action-container">
      <h2 class="action-title">🎨 前の人の絵</h2>
      <p class="action-desc-text">この絵からお題を推測してください。お邪魔虫に負けるな！</p>
      <div class="drawing-bug-wrap" id="bugWrap">
        <img src="${imageData}" class="result-drawing bug-base-img" alt="前の人の絵">
        ${bugsHtml}
      </div>
      <button class="btn btn-primary" id="bugDoneBtn">アクションを選ぶ ▶</button>
    </div>
  `;

  // bugPositions と imageData を次の人へのデータとして渡す
  document.getElementById('bugDoneBtn').onclick = () => {
    onComplete({ imageData, bugPositions });
  };
}

// ===== キャンバス初期化（drawing / flash-draw 共用） =====
function initDrawCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const size = Math.min(rect.width - 16, 420);
    const tmp = canvas.toDataURL();
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = tmp;
  }
  resize();

  let drawing = false, tool = 'pen', lineSize = 4, lineColor = '#222222';

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * sx, y: (t.clientY - r.top) * sy };
  }

  function startDraw(e) { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function moveDraw(e) {
    e.preventDefault();
    if (!drawing) return;
    const p = getPos(e);
    ctx.lineWidth   = tool === 'eraser' ? lineSize * 3 : lineSize;
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : lineColor;
    ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function endDraw(e) { e.preventDefault(); drawing = false; }

  canvas.addEventListener('mousedown',  startDraw);
  canvas.addEventListener('mousemove',  moveDraw);
  canvas.addEventListener('mouseup',    endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove',  moveDraw,  { passive: false });
  canvas.addEventListener('touchend',   endDraw,   { passive: false });

  const penBtn    = document.getElementById('toolPen');
  const eraserBtn = document.getElementById('toolEraser');
  const clearBtn  = document.getElementById('clearBtn');
  const colorPick = document.getElementById('colorPicker');

  penBtn    && (penBtn.onclick    = () => { tool = 'pen'; penBtn.classList.add('active'); eraserBtn && eraserBtn.classList.remove('active'); });
  eraserBtn && (eraserBtn.onclick = () => { tool = 'eraser'; eraserBtn.classList.add('active'); penBtn && penBtn.classList.remove('active'); });
  clearBtn  && (clearBtn.onclick  = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); });
  colorPick && (colorPick.oninput = e  => { lineColor = e.target.value; tool = 'pen'; penBtn && penBtn.classList.add('active'); eraserBtn && eraserBtn.classList.remove('active'); });

  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.onclick = () => {
      lineSize = parseInt(btn.dataset.size);
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
}

// ===== リザルト画面用：お邪魔虫付き絵を描画するHTML生成関数 =====
// bugPositions が存在する場合のみお邪魔虫を重ねる
function buildBugImageHtml(imageData, bugPositions) {
  if (!bugPositions || bugPositions.length === 0) {
    return `<img src="${imageData}" class="result-drawing" alt="絵">`;
  }
  const bugsHtml = bugPositions.map(p => `
    <img src="bug.png" class="ojama-bug"
      style="left:${p.leftPct}%;top:${p.topPct}%;transform:rotate(${p.rotate}deg);"
      alt="お邪魔虫">
  `).join('');
  return `
    <div class="drawing-bug-wrap" style="display:inline-block;width:100%;">
      <img src="${imageData}" class="result-drawing bug-base-img" alt="絵">
      ${bugsHtml}
    </div>
  `;
}
