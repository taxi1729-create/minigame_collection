// actions/half-second-talk.js - 1秒しゃべるアクション（3秒カウントダウン付き）

function renderHalfTalkAction(container, topic, prevRecord, onComplete, onReselect) {
  const prevHtml = prevRecord
    ? (typeof buildPrevContentHtml === 'function' ? buildPrevContentHtml(prevRecord) : '')
    : '';

  container.innerHTML = `
    <div class="action-container">
      <h2 class="action-title">🎤 1秒しゃべる</h2>
      ${prevHtml}
      <div class="current-topic-display">
        <span class="current-topic-label">あなたの修飾語</span>
        <span class="current-topic-value">${topic}</span>
      </div>
      <p class="action-desc-text">
        ボタンを押すと3秒カウントダウン後、<strong>1秒だけ</strong>しゃべれます。<br>
        その1秒に全力でお題を伝えてください！
      </p>

      <div class="halftalk-stage">
        <div class="halftalk-status" id="halftalkStatus">準備ができたらボタンを押してください</div>
        <div class="halftalk-big-count" id="halftalkBigCount" style="display:none;"></div>
        <div class="halftalk-bar-wrap" id="halftalkBarWrap" style="display:none;">
          <div class="halftalk-bar" id="halftalkBar"></div>
          <div class="halftalk-bar-label">しゃべれる時間</div>
        </div>
        <button class="btn btn-danger halftalk-btn" id="halktalkStartBtn">🎤 スタート！</button>
      </div>

      <button class="btn btn-primary" id="halftalkDoneBtn" style="display:none;">伝えた → 次の人へ ▶</button>
      <button class="btn btn-reselect" id="halftalkReselectBtn">↩ アクションを選び直す</button>
    </div>
  `;

  const startBtn  = document.getElementById('halktalkStartBtn');
  const statusEl  = document.getElementById('halftalkStatus');
  const bigCount  = document.getElementById('halftalkBigCount');
  const barWrap   = document.getElementById('halftalkBarWrap');
  const bar       = document.getElementById('halftalkBar');
  const doneBtn   = document.getElementById('halftalkDoneBtn');

  startBtn.onclick = () => {
    startBtn.disabled = true;
    statusEl.textContent = '準備して…';

    // ===== 3秒カウントダウン =====
    bigCount.style.display = 'block';
    let count = 3;
    bigCount.textContent = count;
    bigCount.classList.add('halftalk-countdown-anim');

    const countdown = setInterval(() => {
      count--;
      if (count > 0) {
        bigCount.textContent = count;
        // アニメーションをリセットして再発火
        bigCount.classList.remove('halftalk-countdown-anim');
        void bigCount.offsetWidth; // reflow
        bigCount.classList.add('halftalk-countdown-anim');
        SoundManager && SoundManager.playBeep && SoundManager.playBeep(660, 0.08, 'square');
        vibrate && vibrate([20]);
      } else {
        // カウントダウン終了 → GO!
        clearInterval(countdown);
        bigCount.textContent = 'GO!';
        bigCount.style.color = 'var(--red, #ff2d55)';
        bigCount.classList.remove('halftalk-countdown-anim');
        void bigCount.offsetWidth;
        bigCount.classList.add('halftalk-go-anim');

        SoundManager && SoundManager.playBeep && SoundManager.playBeep(880, 0.12, 'square');
        vibrate && vibrate([60]);
        statusEl.textContent = '今すぐしゃべってください！';

        // バー表示開始
        bigCount.style.display = 'none';
        barWrap.style.display = 'block';
        bar.style.transition = 'none';
        bar.style.width = '100%';
        // 次フレームでアニメーション開始
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            bar.style.transition = 'width 1s linear';
            bar.style.width = '0%';
          });
        });

        // ===== 1秒後に終了 =====
        setTimeout(() => {
          SoundManager && SoundManager.playBuzz && SoundManager.playBuzz();
          vibrate && vibrate([100]);
          statusEl.textContent = '終了！次の人へ渡してください。';
          barWrap.style.display = 'none';
          doneBtn.style.display = 'block';
        }, 1000);
      }
    }, 1000);
  };

  doneBtn.onclick = () => onComplete({ note: '1秒しゃべりました' });
  document.getElementById('halftalkReselectBtn').onclick = onReselect;
}
