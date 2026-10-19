// game.js - ゲームロジック・状態管理

const GameState = {
  // 設定
  playerCount: 3,
  difficulty: 'normal',
  gameMode: 'hard',     // 'normal' | 'hard'  ← デフォルトはハード
  volume: 0.5,
  claudeApiKey: '',

  // ゲーム中の状態
  baseTopic: '',
  category: '',
  currentModifiers: [],
  modifierCategories: [],
  modifierOrder: [],
  currentPlayerIndex: 0,
  roundData: [],
  isCorrect: null,
  usedModifiers: [],

  reset() {
    this.baseTopic = '';
    this.category = '';
    this.currentModifiers = [];
    this.modifierCategories = [];
    this.modifierOrder = [];
    this.currentPlayerIndex = 0;
    this.roundData = [];
    this.isCorrect = null;
    this.usedModifiers = [];
    // gameMode, playerCount, difficulty, claudeApiKey はリセットしない（設定値）
  },

  get currentTopic() {
    if (this.currentModifiers.length === 0) return this.baseTopic;
    return this.currentModifiers.join('') + this.baseTopic;
  },

  get currentPlayer() { return this.currentPlayerIndex + 1; },
  get isLastPlayer()  { return this.currentPlayerIndex === this.playerCount - 1; },
  get isFirstPlayer() { return this.currentPlayerIndex === 0; },

  nextPlayer() {
    const nextIdx    = this.currentPlayerIndex + 1;
    const nextIsLast = nextIdx === this.playerCount - 1;

    if (!nextIsLast) {
      const phaseIdx  = this.currentModifiers.length;
      const catKey    = this.modifierOrder[phaseIdx] || 'outer';
      const newMod    = getModifierFromCategory(catKey, this.difficulty, this.usedModifiers);

      this.currentModifiers.unshift(newMod);
      this.modifierCategories.unshift(catKey);
      this.usedModifiers.push(newMod);
    }

    this.currentPlayerIndex++;
  },

  recordAction(actionType, actionData) {
    this.roundData.push({
      playerIndex: this.currentPlayerIndex,
      actionType,
      actionData,
      topicAtTime: this.currentTopic,
      newModifier:         this.currentModifiers[0]    || null,
      newModifierCategory: this.modifierCategories[0]  || null,
      timestamp: Date.now()
    });
  }
};

// ===== サウンド管理 =====
const SoundManager = {
  context: null, gainNode: null,

  init() {
    if (this.context) { if (this.context.state === 'suspended') this.context.resume(); this.setVolume(); return; }
    try {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
      this.setVolume(GameState.volume);
    } catch(e) { console.warn('Web Audio API not supported'); }
  },

  setVolume() { // 音量はタイトルの設定に従う
    const s = window.Kit ? Kit.settings.get() : { volume: GameState.volume, muted: false };
    const vol = s.muted ? 0 : s.volume;
    GameState.volume = vol;
    if (this.gainNode) this.gainNode.gain.value = vol;
  },

  playBeep(freq = 440, duration = 0.15, type = 'sine') {
    if (!this.context) this.init();
    if (!this.context) return;
    this.setVolume();
    if (!GameState.volume) return;
    try {
      if (this.context.state === 'suspended') this.context.resume();
      const osc = this.context.createOscillator();
      const eg  = this.context.createGain();
      osc.connect(eg); eg.connect(this.gainNode);
      osc.type = type; osc.frequency.value = freq;
      eg.gain.setValueAtTime(0.5, this.context.currentTime);
      eg.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
      osc.start(this.context.currentTime);
      osc.stop(this.context.currentTime + duration);
    } catch(e) {}
  },

  playNext()      { Kit.SE.play('ok'); },
  playWrong()     { Kit.SE.play('ng'); },
  playCorrect()   { Kit.SE.play('ok'); },
  playClick()     { /* 押下音は共通キットが鳴らす */ },
  playCountdown() { Kit.SE.play('count'); },
  playBuzz()      { Kit.SE.play('buzz'); }
};

function vibrate(pattern = [50]) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

// ===== AI（タイトルの「設定変更」で選んだ Claude / Gemini を使う）=====
function aiReady() { return !!(window.Kit && Kit.ai.current().ready); }
async function callAI(prompt) {
  if (!aiReady()) return null;
  try {
    const r = await Kit.ai.ask({ prompt, maxTokens: 400 });
    return (r.text || '').trim() || null;
  } catch (e) {
    console.error('AI error:', e);
    if (window.Kit && e && e.message) Kit.toast(e.message, 2600);
    return null;
  }
}
// 旧名の呼び出しにも対応
const callClaude = callAI, callGemini = callAI;

// ===== ローカル答え判定（類義語・順序不問） =====
function judgeAnswerLocally(answer, modifiers, baseTopic) {
  // ベースのお題が回答に含まれていなければ即不正解
  if (!answer.includes(baseTopic)) {
    return { isCorrect: false, matchedCount: 0, total: modifiers.length };
  }
  if (modifiers.length === 0) {
    return { isCorrect: true, matchedCount: 0, total: 0 };
  }

  let matchedCount = 0;
  for (const mod of modifiers) {
    // 修飾語そのものが含まれているか
    if (answer.includes(mod)) {
      matchedCount++;
      continue;
    }
    // 類義語リストを参照
    const synonyms = MODIFIER_SYNONYMS[mod] || [];
    if (synonyms.some(s => answer.includes(s))) {
      matchedCount++;
    }
  }

  // 半分以上伝わっていれば正解
  const isCorrect = matchedCount >= Math.ceil(modifiers.length / 2);
  return { isCorrect, matchedCount, total: modifiers.length };
}
