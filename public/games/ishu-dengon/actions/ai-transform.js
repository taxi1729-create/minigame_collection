// actions/ai-transform.js - AI変換アクション（Gemini版・自己入力→変換方式）

// renderAiTransformAction(container, topic, prevRecord, onComplete, onReselect)
function renderAiTransformAction(container, topic, prevRecord, onComplete, onReselect) {
  const prevHtml = prevRecord
    ? (typeof buildPrevContentHtml === 'function' ? buildPrevContentHtml(prevRecord) : '')
    : '';

  container.innerHTML = `
    <div class="action-container ai-action">
      <h2 class="action-title">🤖 AI変換</h2>
      ${prevHtml}
      <div class="current-topic-display">
        <span class="current-topic-label">あなたの修飾語（AI変換対象）</span>
        <span class="current-topic-value">${GameState.currentModifiers.length > 0 ? GameState.currentModifiers[0] : topic}</span>
      </div>
      <p class="action-desc-text">
        お題を見て、あなたが思う表現を入力してください。<br>
        入力後に「AI変換」ボタンを押すと、AIが言い換えてくれます。<br>
        変換結果を次の人に見せてください。
      </p>

      <div class="ai-input-area">
        <textarea id="aiUserInput" class="ai-textarea"
          placeholder="例：人類を誘惑した果実、重力に逆らう生き物…" rows="3"></textarea>
        <button class="btn btn-primary" id="aiConvertBtn">🤖 AI変換する</button>
      </div>

      <div class="ai-result-box" id="aiResult" style="display:none;"></div>
      <button class="btn btn-primary" id="aiDoneBtn" style="display:none;">次の人へ渡す ▶</button>
      <button class="btn btn-reselect" id="aiReselectBtn">↩ アクションを選び直す</button>
    </div>
  `;

  let resultText = '';

  document.getElementById('aiConvertBtn').onclick = async () => {
    const userInput = document.getElementById('aiUserInput').value.trim();
    if (!userInput) {
      document.getElementById('aiUserInput').placeholder = '何か入力してください！';
      return;
    }

    const convertBtn = document.getElementById('aiConvertBtn');
    convertBtn.disabled = true;
    convertBtn.textContent = '変換中…';

    const resultBox = document.getElementById('aiResult');
    resultBox.style.display = 'flex';
    resultBox.innerHTML = `<div class="loading-spinner"></div>`;

    const prompt = `以下のお題と、プレイヤーの表現をもとに、尖った・哲学的・詩的・または誇張した視点で1〜2文に言い換えてください。ユーモアや皮肉を含めてOKです。言い換えた文章のみ返してください。余分な説明は不要です。\n\nお題：${topic}\nプレイヤーの表現：${userInput}`;

    const text = await callAI(prompt);
    resultText = text || `（${userInput}）※AIが使えないためそのまま表示`;

    resultBox.innerHTML = '';
    const pEl = document.createElement('p'); pEl.className = 'ai-text'; pEl.textContent = resultText; resultBox.appendChild(pEl);
    convertBtn.textContent = '再変換する';
    convertBtn.disabled = false;

    const doneBtn = document.getElementById('aiDoneBtn');
    doneBtn.style.display = 'block';
    doneBtn.onclick = () => onComplete({ text: resultText, userInput });
  };

  document.getElementById('aiReselectBtn').onclick = onReselect;
}
