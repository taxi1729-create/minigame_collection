// actions/gesture-hint.js - ジェスチャー＋ヒント文字アクション
// ヒント文字：今回追加された修飾語の先頭2文字を相手に見せる

function renderGestureHintAction(container, topic, prevRecord, onComplete, onReselect) {
  const prevHtml = prevRecord
    ? (typeof buildPrevContentHtml === 'function' ? buildPrevContentHtml(prevRecord) : '')
    : '';

  // 今回追加された修飾語の先頭2文字
  const newMod   = GameState.currentModifiers.length > 0 ? GameState.currentModifiers[0] : '';
  const hintText = newMod.length > 0 ? newMod.slice(0, 2) : '？？';

  container.innerHTML = `
    <div class="action-container">
      <h2 class="action-title">🙌✍️ ジェスチャー＋ヒント</h2>
      ${prevHtml}
      <div class="current-topic-display">
        <span class="current-topic-label">あなたの修飾語</span>
        <span class="current-topic-value">${topic}</span>
      </div>
      <p class="action-desc-text">
        ジェスチャーで伝えながら、追加された修飾語の<strong>先頭2文字</strong>を次の人に見せます。
      </p>

      <div class="gesture-hint-stage">
        <div class="gesture-hint-icon">🙌</div>
        <div class="gesture-hint-chip">
          <span class="gesture-hint-label">ヒント文字（先頭2文字）</span>
          <span class="gesture-hint-chars">${hintText}</span>
          <span class="gesture-hint-full">（修飾語：${newMod || 'なし'}）</span>
        </div>
        <p class="action-desc-text">この画面を次の人に見せながらジェスチャーしてください。</p>
      </div>

      <button class="btn btn-primary" id="gestureHintDoneBtn">伝えた → 次の人へ ▶</button>
      <button class="btn btn-reselect" id="gestureHintReselectBtn">↩ アクションを選び直す</button>
    </div>
  `;

  document.getElementById('gestureHintDoneBtn').onclick = () =>
    onComplete({ note: 'ジェスチャー＋ヒント', hintText, fullModifier: newMod });
  document.getElementById('gestureHintReselectBtn').onclick = onReselect;
}
