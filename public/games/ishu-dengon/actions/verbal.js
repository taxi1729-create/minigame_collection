// actions/verbal.js - 口頭アクション（縛り付き・最後から2人目のみ）

const VERBAL_CONSTRAINTS = [
  { name: '文字数制限',         description: '10文字以内で説明してください' },
  { name: '濁音禁止',           description: '「が・ぎ・ぐ・ざ・じ・ず・だ・ど・ば・び・ぶ・ぱ・ぴ・ぷ」などの濁音・半濁音は使用禁止！' },
  { name: '語尾縛り「〜にゃ」', description: '全ての文の語尾を「〜にゃ」で終わらせてください' },
  { name: '疑問文のみ',         description: '全ての説明を疑問文（「〜ですか？」）で行ってください' },
  { name: 'オノマトペのみ',     description: '擬音語・擬態語のみで説明してください（例：ふわふわ、ガツン、キラキラ）' },
  { name: '名詞禁止',           description: '名詞を使わずに動詞・形容詞のみで説明してください' },
];

function getRandomConstraint() {
  return VERBAL_CONSTRAINTS[Math.floor(Math.random() * VERBAL_CONSTRAINTS.length)];
}

function renderVerbalAction(container, prevData, onComplete, onReselect) {
  const constraint = getRandomConstraint();

  // prevData は actionData（prevRecord.actionData）が渡ってくる
  let prevHtml = '';
  if (prevData) {
    if (prevData.imageData) {
      prevHtml = `<div class="verbal-hint-box"><p class="verbal-hint-label">前の人のヒント</p><img src="${prevData.imageData}" class="result-drawing-small" alt="前の人の内容"></div>`;
    } else if (prevData.text) {
      prevHtml = `<div class="verbal-hint-box"><p class="verbal-hint-label">前の人のヒント</p><p class="verbal-hint-text">${prevData.text}</p></div>`;
    }
  }

  container.innerHTML = `
    <div class="action-container verbal-action">
      <h2 class="action-title">💬 口頭で伝える</h2>
      ${prevHtml}
      <div class="constraint-badge">
        <span class="constraint-label">縛り</span>
        <span class="constraint-name">${constraint.name}</span>
      </div>
      <p class="constraint-desc">${constraint.description}</p>
      <div class="verbal-instructions">
        <p>この縛りを守りながら口頭でお題を伝えてください。</p>
        <p>最後の人が答えを入力したら判定に進みます。</p>
      </div>
      <button class="btn btn-primary" id="verbalDoneBtn">口頭で伝えた → 次の人へ ▶</button>
      <button class="btn btn-reselect" id="verbalReselectBtn">↩ アクションを選び直す</button>
    </div>
  `;

  document.getElementById('verbalDoneBtn').onclick = () => {
    onComplete({ constraint: constraint.name, constraintDesc: constraint.description });
  };
  document.getElementById('verbalReselectBtn').onclick = onReselect;
}
