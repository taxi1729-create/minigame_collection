/* =========================================================
   あそびばこ 共通キット
   効果音 / セーブ / ホームボタン / クリア演出 / トースト / 確認
   ========================================================= */
(function(){
'use strict';
// kit.js 自身の場所（音楽ファイルの場所をここから決める）
const KIT_SRC = (document.currentScript && document.currentScript.src) || (typeof location !== 'undefined' ? location.href : '');
const NS = 'asobibako';

/* ---------- storage（端末内のキー値。APIキーなど同期しないもの） ---------- */
const store = {
  get(k, d){ try{ const v = localStorage.getItem(NS+'.'+k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(NS+'.'+k, JSON.stringify(v)); return true; }catch(e){ return false; } },
  del(k){ try{ localStorage.removeItem(NS+'.'+k); }catch(e){} },
};

/* =========================================================
   セーブデータ本体（1つのJSONドキュメント）
   端末に保存し、クラウド接続時は同じ内容を同期する。
   doc = {
     v: 1,
     profile: { main, friends:[...], at },          // 基本プレイヤー名と追加プレイヤー名
     saves:   { <gameId>: { at, data|null } },       // 途中セーブ（null は削除済み）
     best:    { <key>: { at, v } },                  // 自己ベスト
     records: [ { id, at, game, player, result, score?, detail?, group? } ],  // 成績
   }
   ========================================================= */
const DOC_KEY = 'doc';
const now = () => Date.now();
const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);
function emptyDoc(){ return { v:1, profile:{ main:'', friends:[], at:0 }, saves:{}, best:{}, records:[], deleted:{} }; }
function loadDoc(){
  let d = store.get(DOC_KEY, null);
  if(!d){
    d = emptyDoc();
    // 旧形式（asobibako.save.* / best.*）から移行
    try{
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i); if(!k || !k.startsWith(NS+'.')) continue;
        const sub = k.slice(NS.length+1);
        if(sub.startsWith('save.')){ const v = store.get(sub, null); if(v) d.saves[sub.slice(5)] = { at: v.at||now(), data: v.data }; }
        if(sub.startsWith('best.')){ const v = store.get(sub, null); if(v != null) d.best[sub.slice(5)] = { at: now(), v }; }
      }
    }catch(e){}
    store.set(DOC_KEY, d);
  }
  return Object.assign(emptyDoc(), d);
}
let DOC = loadDoc();
const listeners = new Set();
function commit(reason){
  const ok = store.set(DOC_KEY, DOC);
  listeners.forEach(fn => { try{ fn(reason); }catch(e){} });
  Cloud._dirty();
  return ok;
}
function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

/* ---------- 設定（端末ごと。同期しない） ---------- */
const URL_PLAYERS = (() => { try{ const n = parseInt(new URLSearchParams(location.search).get('players'), 10); return n >= 1 && n <= 8 ? n : 0; }catch(e){ return 0; } })();
const SETTINGS_DEFAULT = { volume: 0.7, bgmVolume: 0.45, muted: false, partySize: 3, aiProvider: '', keys: { claude:'', gemini:'' }, models: { claude:'claude-sonnet-5-5', gemini:'gemini-3.5-flash-lite' } };
const settings = {
  get(){
    const s = store.get('settings', {});
    const out = Object.assign({}, SETTINGS_DEFAULT, s, { keys: Object.assign({}, SETTINGS_DEFAULT.keys, s.keys||{}), models: Object.assign({}, SETTINGS_DEFAULT.models, s.models||{}) });
    // 使うAIが未選択なら、キーが入っている方（両方なら Claude）
    if(out.aiProvider !== 'claude' && out.aiProvider !== 'gemini'){
      const sv = store.get('serverAI', null);
      out.aiProvider = out.keys.claude ? 'claude' : out.keys.gemini ? 'gemini'
        : (sv && sv.provider === 'gemini' && sv.server && sv.server.gemini) ? 'gemini' : 'claude';
    }
    if(URL_PLAYERS) out.partySize = URL_PLAYERS; // ?players=N で開いたページだけ人数を上書き（保存はしない）
    return out;
  },
  set(patch){
    const cur = Object.assign({}, SETTINGS_DEFAULT, store.get('settings', {}));
    cur.keys = Object.assign({}, SETTINGS_DEFAULT.keys, cur.keys||{});
    cur.models = Object.assign({}, SETTINGS_DEFAULT.models, cur.models||{});
    const prevKeys = cur.keys, prevModels = cur.models;
    const next = Object.assign(cur, patch);
    if(patch.keys) next.keys = Object.assign({}, prevKeys, patch.keys);
    if(patch.models) next.models = Object.assign({}, prevModels, patch.models);
    store.set('settings', next);
    if('volume' in patch || 'muted' in patch) SE._apply();
    if(('bgmVolume' in patch || 'muted' in patch) && typeof Music !== 'undefined') Music._apply();
    listeners.forEach(fn => { try{ fn('settings'); }catch(e){} });
    return next;
  },
};
// 旧初期モデル（gemini-3.8-flash）が保存されている端末は新しい初期値に置き換える（1回だけ）
if(!store.get('mig.geminiModel', false)){
  const s0 = store.get('settings', null);
  if(s0 && s0.models && s0.models.gemini === 'gemini-3.8-flash'){ s0.models.gemini = 'gemini-3.5-flash-lite'; store.set('settings', s0); }
  store.set('mig.geminiModel', true);
}
// 旧ミュート設定の移行
if(store.get('mute', null) != null){ const s = store.get('settings', {}); if(s.muted == null){ s.muted = !!store.get('mute', false); store.set('settings', s); } store.del('mute'); }

/* ---------- プレイヤー ---------- */
const profile = {
  get(){ return { main: DOC.profile.main || '', friends: (DOC.profile.friends||[]).slice() }; },
  set({main, friends}){
    if(main != null) DOC.profile.main = String(main).trim().slice(0, 12);
    if(friends != null) DOC.profile.friends = friends.map(s => String(s).trim().slice(0, 12)).filter(Boolean).slice(0, 20);
    DOC.profile.at = now(); commit('profile');
  },
};
function mainName(){ return DOC.profile.main || 'あなた'; }
/* n人ぶんの名前：[基本プレイヤー, 追加プレイヤー..., 足りなければ「プレイヤーk」] */
function players(n){
  n = n == null ? settings.get().partySize : n;
  const seen = new Set(), list = [];
  [mainName(), ...(DOC.profile.friends||[])].forEach(x => { if(x && !seen.has(x)){ seen.add(x); list.push(x); } });
  const out = [];
  for(let i=0; i<n; i++){
    let name = list[i];
    for(let k=i+1; !name; k++){ const c = `プレイヤー${k}`; if(!seen.has(c)){ seen.add(c); name = c; } }
    out.push(name);
  }
  return out;
}

/* ---------- 成績 ---------- */
// result: 'win' | 'lose' | 'clear' | 'fail' | 'play'
function record(r){
  if(!r || !r.game) return null;
  const who = String(r.player || mainName()).slice(0, 12);
  const rec = { id: uid(), at: now(), game: r.game, player: who, result: r.result || 'play' };
  if(who === mainName()) rec.me = true; // 基本プレイヤーの記録（名前を後で変えても自分の成績として扱う）
  if(r.score != null && isFinite(r.score)) rec.score = Number(r.score);
  if(r.detail) rec.detail = String(r.detail).slice(0, 80);
  if(r.group) rec.group = String(r.group).slice(0, 40); // 同じ対戦の記録を束ねるID
  DOC.records.push(rec);
  if(DOC.records.length > 3000) DOC.records = DOC.records.slice(-3000);
  commit('record');
  return rec;
}
// 基本プレイヤーの記録は、いまの基本プレイヤー名で返す
const view = r => r.me ? Object.assign({}, r, { player: mainName() }) : r;
function records(filter={}){
  return DOC.records.map(view).filter(r => (!filter.game || r.game === filter.game) && (!filter.player || r.player === filter.player));
}
function deleteRecords(pred){
  const t = now(); let n = 0;
  DOC.records = DOC.records.filter(r => { if(pred(view(r))){ DOC.deleted[r.id] = t; n++; return false; } return true; });
  if(n) commit('record');
}
function newGroup(){ return uid(); }

/* ---------- 効果音（Web Audio で合成、音源ファイル不要） ---------- */
const SE = (() => {
  let ctx = null, master = null;
  let muted = !!settings.get().muted;
  function vol(){ const s = settings.get(); return s.muted ? 0 : Math.max(0, Math.min(1, s.volume)); }
  function ensure(){
    if(!ctx){
      try{
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = vol(); master.connect(ctx.destination);
      }catch(e){ return null; }
    }
    if(ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, t0, dur, {type='triangle', vol=.35, slide=0, attack=.008}={}){
    const c = ensure(); if(!c || muted) return;
    const t = c.currentTime + t0;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq*slide), t+dur);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t+attack);
    g.gain.exponentialRampToValueAtTime(.0001, t+dur);
    o.connect(g).connect(master); o.start(t); o.stop(t+dur+.02);
  }
  function noise(t0, dur, {vol=.25, hp=800}={}){
    const c = ensure(); if(!c || muted) return;
    const len = Math.floor(c.sampleRate*dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i] = (Math.random()*2-1)*(1-i/len);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type='highpass'; f.frequency.value = hp; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(master); s.start(c.currentTime+t0);
  }
  const lib = {
    click(){ tone(880,0,.05,{type:'square',vol:.12}); },
    pop(){ tone(520,0,.09,{type:'sine',vol:.3,slide:1.9}); },
    select(){ tone(660,0,.06,{type:'triangle',vol:.22}); tone(990,.05,.08,{type:'triangle',vol:.2}); },
    ok(){ tone(784,0,.1); tone(1175,.08,.16); },
    ng(){ tone(220,0,.22,{type:'sawtooth',vol:.18,slide:.7}); },
    tick(){ tone(1400,0,.03,{type:'square',vol:.08}); },
    count(){ tone(880,0,.09,{type:'square',vol:.14}); },
    go(){ tone(1320,0,.25,{type:'square',vol:.16}); },
    start(){ [523,659,784,1046].forEach((f,i)=>tone(f,i*.06,.12,{vol:.22})); },
    whoosh(){ noise(0,.25,{vol:.18,hp:1200}); },
    save(){ tone(988,0,.07,{type:'sine',vol:.25}); tone(1319,.07,.12,{type:'sine',vol:.25}); },
    slide(){ tone(300,0,.06,{type:'sine',vol:.2,slide:1.5}); },
    stamp(){ noise(0,.12,{vol:.35,hp:200}); tone(110,0,.18,{type:'sine',vol:.5,slide:.6}); },
    fanfare(){
      const n = [[523,0,.14],[659,.14,.14],[784,.28,.14],[1046,.42,.5],[784,.42,.5],[659,.42,.5]];
      n.forEach(([f,t,d])=>tone(f,t,d,{type:'square',vol:.12}));
      [1318,1568,2093].forEach((f,i)=>tone(f,.95+i*.07,.18,{type:'triangle',vol:.14}));
    },
    fail(){ tone(392,0,.25,{type:'triangle',vol:.25}); tone(330,.25,.25,{type:'triangle',vol:.25}); tone(262,.5,.6,{type:'triangle',vol:.25,slide:.9}); },
    buzz(){ tone(150,0,.5,{type:'sawtooth',vol:.2}); },
  };
  return {
    play(name){ try{ if(!vol()) return; (lib[name]||lib.click)(); }catch(e){} },
    unlock(){ ensure(); },
    _ctx(){ return ensure(); },
    get muted(){ return muted; },
    setMuted(v){ settings.set({ muted: !!v }); },
    _apply(){ muted = !!settings.get().muted; if(master) master.gain.value = vol(); },
  };
})();

/* =========================================================
   音楽（BGM・ジングル）
   - ホーム：Sunday Morning Quest（home）
   - ミニゲーム中：High Score Velocity（play）
   - 成功ジングル：Crown of Coins（win） / 失敗ジングル：Coffee and High Scores（lose）
   曲が切り替わるときは、いつも頭から再生する
   ========================================================= */
const Music = (() => {
  const base = (() => { try{ return new URL('../audio/', KIT_SRC).href; }catch(e){ return '../audio/'; } })();
  const FILES = { home: 'home.mp3', play: 'play.mp3', win: 'win.mp3', lose: 'lose.mp3' };
  const JINGLE_MS = 10500; // ジングルはここまで流したら元のBGMへ
  let bgmEl = null, jEl = null, gain = null, jGain = null;
  let want = '', jingling = false, jTimer = 0, unlocked = false;
  const level = () => { const s = settings.get(); return s.muted ? 0 : Math.max(0, Math.min(1, s.bgmVolume == null ? 0.45 : s.bgmVolume)); };
  function make(){
    if(bgmEl) return;
    bgmEl = new Audio(); bgmEl.loop = true; bgmEl.preload = 'auto';
    jEl = new Audio(); jEl.loop = false; jEl.preload = 'auto';
    jEl.addEventListener('ended', endJingle);
    [bgmEl, jEl].forEach(a => { a.setAttribute('playsinline', ''); a.crossOrigin = 'anonymous'; });
  }
  // iOS では audio.volume が効かないので、Web Audio のゲインで音量を付ける
  function route(){
    if(gain || !bgmEl) return;
    try{
      const ctx = SE._ctx(); if(!ctx) return;
      gain = ctx.createGain(); jGain = ctx.createGain();
      ctx.createMediaElementSource(bgmEl).connect(gain).connect(ctx.destination);
      ctx.createMediaElementSource(jEl).connect(jGain).connect(ctx.destination);
    }catch(e){ gain = jGain = null; }
    apply();
  }
  function apply(){
    const v = level();
    if(gain){ gain.gain.value = v; jGain.gain.value = Math.min(1, v * 1.15); bgmEl.volume = 1; jEl.volume = 1; }
    else if(bgmEl){ bgmEl.volume = v; jEl.volume = Math.min(1, v * 1.15); }
    if(!bgmEl) return;
    if(v === 0){ bgmEl.pause(); jEl.pause(); }
    else if(unlocked && want && !jingling && bgmEl.paused && document.visibilityState !== 'hidden') safePlay(bgmEl);
  }
  function safePlay(a){
    const p = a.play();
    if(p && p.catch) p.catch(() => {}); // 自動再生が止められたら、最初のタップで再生
  }
  function startBgm(fromTop){
    if(!want || !level()) return;
    make();
    const src = base + FILES[want];
    if(bgmEl.dataset.track !== want){ bgmEl.src = src; bgmEl.dataset.track = want; }
    if(fromTop) try{ bgmEl.currentTime = 0; }catch(e){}
    if(unlocked || navigator.userActivation?.hasBeenActive) safePlay(bgmEl);
  }
  // BGM を指定（同じ曲なら何もしない。別の曲なら頭から）
  function bgm(name){
    if(!FILES[name] || name === 'win' || name === 'lose') return;
    const changed = name !== want;
    want = name;
    if(jingling) return; // ジングルが終わったら頭から流れる
    if(changed) startBgm(true);
  }
  function jingle(name){
    if(name !== 'win' && name !== 'lose') return;
    make();
    if(!level()) return;
    jingling = true;
    bgmEl.pause();
    jEl.src = base + FILES[name];
    try{ jEl.currentTime = 0; }catch(e){}
    safePlay(jEl);
    clearTimeout(jTimer); jTimer = setTimeout(endJingle, JINGLE_MS);
  }
  function endJingle(){
    if(!jingling) return;
    clearTimeout(jTimer); jingling = false;
    try{ jEl.pause(); }catch(e){}
    startBgm(true); // 曲が変わるので頭から
  }
  function unlock(){
    unlocked = true; make(); route();
    if(want && !jingling && bgmEl.paused) startBgm(!bgmEl.currentTime);
  }
  if(typeof document !== 'undefined'){
    ['pointerdown', 'keydown', 'touchend'].forEach(t => document.addEventListener(t, unlock, { once: true, capture: true }));
    document.addEventListener('visibilitychange', () => {
      if(!bgmEl) return;
      if(document.visibilityState === 'hidden'){ bgmEl.pause(); jEl.pause(); }
      else if(want && !jingling && unlocked && level()) safePlay(bgmEl);
    });
  }
  return { bgm, jingle, stopJingle: endJingle, _apply: apply, get track(){ return want; },
    _state(){ return { want, jingling, unlocked, src: bgmEl && bgmEl.dataset.track, paused: bgmEl ? bgmEl.paused : true, t: bgmEl ? bgmEl.currentTime : 0, jsrc: jEl && jEl.src, jpaused: jEl ? jEl.paused : true }; } };
})();

/* ---------- 途中セーブ / 自己ベスト ---------- */
function save(id, data){
  DOC.saves[id] = { at: now(), data };
  if(commit('save')) return true;
  // 容量オーバー：直前の状態に戻して失敗を返す
  DOC.saves[id] = { at: now(), data: null }; commit('save'); return false;
}
function load(id){ const s = DOC.saves[id]; return s && s.data != null ? s.data : null; }
function saveInfo(id){ const s = DOC.saves[id]; return s && s.data != null ? { at: s.at, data: s.data } : null; }
function clearSave(id){ if(DOC.saves[id] && DOC.saves[id].data == null) return; DOC.saves[id] = { at: now(), data: null }; commit('save'); }
function best(id, value, better){ // better(a,b): a が b より良いなら true
  const cur = DOC.best[id] ? DOC.best[id].v : null;
  if(value === undefined) return cur;
  if(cur == null || better(value, cur)){ DOC.best[id] = { at: now(), v: value }; commit('best'); return true; }
  return false;
}

/* =========================================================
   クラウド同期（GitHub Gist）
   - 個人のGitHubアカウントに「非公開Gist」を1つ作り、そこに doc を保存
   - トークンとAPIキーは同期しない（端末にだけ保存）
   - 統合ルール：成績はIDで合算、セーブ・ベスト・プレイヤー名は新しい方を採用
   ========================================================= */
const GIST_FILE = 'asobibako-save.json';
const GIST_DESC = 'あそびばこ セーブデータ（自動同期）';
function mergeDocs(a, b){
  const out = emptyDoc();
  out.profile = (b.profile && (b.profile.at||0) > (a.profile.at||0)) ? b.profile : a.profile;
  const keys = (x, y) => new Set([...Object.keys(x||{}), ...Object.keys(y||{})]);
  keys(a.saves, b.saves).forEach(k => { const x = a.saves[k], y = (b.saves||{})[k]; out.saves[k] = !y ? x : !x ? y : (y.at > x.at ? y : x); });
  keys(a.best, b.best).forEach(k => { const x = a.best[k], y = (b.best||{})[k]; out.best[k] = !y ? x : !x ? y : (y.at > x.at ? y : x); });
  out.deleted = Object.assign({}, b.deleted||{}, a.deleted||{});
  const seen = new Map();
  [...(a.records||[]), ...(b.records||[])].forEach(r => { if(r && r.id && !seen.has(r.id) && !out.deleted[r.id]) seen.set(r.id, r); });
  out.records = [...seen.values()].sort((p, q) => p.at - q.at).slice(-3000);
  return out;
}
const Cloud = (() => {
  let timer = 0, busy = false, again = false;
  const cfg = () => store.get('cloud', { provider: 'none', token: '', gistId: '', lastSync: 0, lastError: '' });
  const setCfg = p => store.set('cloud', Object.assign(cfg(), p));
  async function gh(path, opt={}){
    const c = cfg();
    const res = await fetch('https://api.github.com' + path, Object.assign({}, opt, {
      headers: Object.assign({ 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + c.token }, opt.body ? { 'Content-Type': 'application/json' } : {}),
    }));
    if(!res.ok){
      const e = await res.json().catch(() => ({}));
      throw new Error(res.status === 401 ? 'トークンが正しくありません' : res.status === 404 ? 'Gistが見つかりません（トークンに gist 権限があるか確認）' : (e.message || ('HTTP ' + res.status)));
    }
    return res.json();
  }
  async function findOrCreate(){
    const c = cfg();
    if(c.gistId) return c.gistId;
    const list = await gh('/gists?per_page=100');
    const hit = list.find(g => g.files && g.files[GIST_FILE]);
    if(hit){ setCfg({ gistId: hit.id }); return hit.id; }
    const made = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify(DOC) } } }) });
    setCfg({ gistId: made.id }); return made.id;
  }
  async function sync(){
    const c = cfg();
    if(c.provider !== 'gist' || !c.token) return { ok: false, skipped: true };
    if(busy){ again = true; return { ok: false, skipped: true }; }
    busy = true; emit('syncing');
    try{
      const id = await findOrCreate();
      const g = await gh('/gists/' + id);
      const f = g.files && g.files[GIST_FILE];
      let remote = null;
      if(f){
        const text = f.truncated && f.raw_url ? await (await fetch(f.raw_url)).text() : f.content;
        try{ remote = JSON.parse(text); }catch(e){ remote = null; }
      }
      const merged = remote ? mergeDocs(DOC, Object.assign(emptyDoc(), remote)) : DOC;
      DOC = merged; store.set(DOC_KEY, DOC);
      await gh('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(DOC) } } }) });
      setCfg({ lastSync: now(), lastError: '' });
      listeners.forEach(fn => { try{ fn('sync'); }catch(e){} });
      emit('ok'); return { ok: true };
    }catch(e){
      setCfg({ lastError: e.message || String(e) }); emit('error'); return { ok: false, error: e.message || String(e) };
    }finally{ busy = false; if(again){ again = false; setTimeout(sync, 300); } }
  }
  const subs = new Set();
  function emit(s){ subs.forEach(fn => { try{ fn(s); }catch(e){} }); }
  return {
    status(){ const c = cfg(); return { provider: c.provider, connected: c.provider === 'gist' && !!c.token, gistId: c.gistId, lastSync: c.lastSync, lastError: c.lastError, busy }; },
    async connect(token, gistId=''){ setCfg({ provider: 'gist', token: String(token).trim(), gistId: String(gistId).trim(), lastError: '' }); return sync(); },
    disconnect(){ setCfg({ provider: 'none', token: '', gistId: '', lastError: '' }); emit('off'); },
    sync,
    onStatus(fn){ subs.add(fn); return () => subs.delete(fn); },
    _dirty(){ if(!Cloud.status().connected) return; clearTimeout(timer); timer = setTimeout(sync, 4000); },
  };
})();

/* =========================================================
   AI（Claude / Gemini）共通呼び出し
   - 使うAIは設定の aiProvider（'claude' | 'gemini'）
   - キーとモデル名は設定の keys / models（手入力）
   Kit.ai.ask({ system, prompt, maxTokens, search, json, signal })
     → { text, json, sources:Set<url>, provider, model }
   失敗時は Kit.ai.Error（message は画面にそのまま出せる日本語、detail は技術情報）
   ========================================================= */
const AI_DEFAULT_MODELS = { claude: 'claude-sonnet-5-5', gemini: 'gemini-3.5-flash-lite' };
const AI_LABEL = { claude: 'Claude', gemini: 'Gemini' };
class AIError extends Error{ constructor(msg, detail, status){ super(msg); this.detail = detail || ''; this.status = status || 0; } }
const ai = (() => {
  /* ---- サーバ（Cloudflare Worker）側のAI ----
     自分のキーが入っていればそれを優先。無ければサーバのキーを合言葉つきで使う */
  const API = path => new URL('/api/' + path, location.origin).href;
  const server = () => store.get('serverAI', null);   // {provider, server:{claude,gemini}, models:{...}, passcode}
  const unlocked = () => !!store.get('passcodeOk', false) && !!store.get('passcode', '');
  function current(){
    const s = settings.get();
    const provider = s.aiProvider === 'gemini' ? 'gemini' : 'claude';
    const own = (s.keys[provider] || '').trim();
    const label = AI_LABEL[provider];
    if(own){
      const model = ((s.models || {})[provider] || '').trim() || AI_DEFAULT_MODELS[provider];
      return { provider, key: own, model, label, ready: true, via: 'own' };
    }
    const sv = server();
    if(sv && sv.server && sv.server[provider]){
      const model = (sv.models || {})[provider] || AI_DEFAULT_MODELS[provider];
      if(sv.user) return { provider, key: '', model, label, ready: true, via: 'server', user: sv.user.email, unlimited: true };
      const ok = unlocked();
      const g = sv.guest || null, out = g && g.limit != null && g.remaining <= 0;
      return { provider, key: '', model, label, ready: ok && !out, via: 'server', needPasscode: !ok, guestOut: !!out, guest: g };
    }
    const model = ((s.models || {})[provider] || '').trim() || AI_DEFAULT_MODELS[provider];
    return { provider, key: '', model, label, ready: false, via: 'none' };
  }
  async function refreshServer(){
    try{
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(API('config'), { signal: ctl.signal, cache: 'no-store', credentials: 'same-origin' }).finally(() => clearTimeout(t));
      const ct = res.headers.get('content-type') || '';
      if(!res.ok || !ct.includes('json')){ store.del('serverAI'); return null; } // Worker の無い環境（ローカルや他のホスティング）
      const cfg = await res.json();
      store.set('serverAI', cfg);
      if(!cfg.passcode){ store.del('passcodeOk'); }
      listeners.forEach(fn => { try{ fn('settings'); }catch(e){} });
      return cfg;
    }catch(e){ return server(); } // 通信失敗時は前回の情報のまま
  }
  async function unlock(passcode){
    passcode = String(passcode || '').trim();
    if(!passcode) return { ok: false, error: '合言葉を入れてください' };
    let res, data;
    try{
      res = await fetch(API('auth'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode }) });
      data = await res.json().catch(() => null);
    }catch(e){ return { ok: false, error: 'サーバにつながりませんでした' }; }
    if(res.ok && data && data.ok){
      store.set('passcode', passcode); store.set('passcodeOk', true);
      listeners.forEach(fn => { try{ fn('settings'); }catch(e){} });
      return { ok: true };
    }
    return { ok: false, error: (data && data.error && data.error.message) || '合言葉を確認できませんでした' };
  }
  // ゲストの残り回数を更新（サーバの返事から）
  function setGuest(q){
    const sv = server(); if(!sv) return;
    sv.guest = Object.assign({}, sv.guest || {}, q);
    if(sv.guest.limit != null && sv.guest.used != null && q.remaining == null) sv.guest.remaining = Math.max(0, sv.guest.limit - sv.guest.used);
    store.set('serverAI', sv);
    listeners.forEach(fn => { try{ fn('settings'); }catch(e){} });
  }
  // Googleログイン（GIS の credential をサーバに渡す）
  async function login(credential){
    let res, data;
    try{
      res = await fetch(API('login'), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) });
      data = await res.json().catch(() => null);
    }catch(e){ return { ok: false, error: 'サーバにつながりませんでした' }; }
    await refreshServer();
    if(res.ok && data && data.ok) return { ok: true, email: data.email };
    return { ok: false, error: (data && data.error && data.error.message) || 'ログインできませんでした' };
  }
  async function logout(){
    try{ await fetch(API('logout'), { method: 'POST', credentials: 'same-origin' }); }catch(e){}
    await refreshServer();
  }
  function lock(){ store.del('passcode'); store.del('passcodeOk'); listeners.forEach(fn => { try{ fn('settings'); }catch(e){} }); }
  async function viaServer(c, o){
    let res, data;
    try{
      res = await fetch(API('ai'), { method: 'POST', signal: o.signal, credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-game-passcode': store.get('passcode', '') },
        body: JSON.stringify({ provider: c.provider, system: o.system || '', prompt: o.prompt, maxTokens: o.maxTokens || 2000, search: !!o.search }) });
      data = await res.json().catch(() => null);
    }catch(e){
      if(e && e.name === 'AbortError') throw e;
      throw new AIError('サーバにつながりませんでした。ネット接続を確認してください', e && e.message);
    }
    if(!res.ok){
      const err = (data && data.error) || {};
      if(err.code === 'bad_passcode'){ lock(); throw new AIError('合言葉が違うか、変わりました。タイトルの「設定変更」で合言葉を入れ直してください', 'bad_passcode', 401); }
      if(err.code === 'guest_limit'){ setGuest({ remaining: 0 }); throw new AIError(err.message, 'guest_limit', 429); }
      if(err.upstream) throw httpErr(err.upstream, err.detail);
      throw new AIError(err.message || 'AIでエラーが起きました', err.detail || `HTTP ${res.status}`, res.status);
    }
    if(data && data.quota && !data.quota.unlimited) setGuest(data.quota);
    if(o.json && data && data.stop === 'max_tokens') throw new AIError('AIの返答が長すぎて途中で切れました。もう一度試してください', 'max_tokens');
    return { text: (data && data.text) || '', sources: new Set((data && data.sources) || []), provider: data && data.provider, model: data && data.model, fallback: !!(data && data.fallback) };
  }
  function httpErr(status, msg){
    msg = msg || '';
    if(status === 401 || status === 403) return new AIError('APIキーが正しくないようです（設定変更で確認してください）', `HTTP ${status} ${msg}`, status);
    if(status === 404) return new AIError('モデル名が見つかりません（設定変更のモデル名を確認してください）', `HTTP ${status} ${msg}`, status);
    if(status === 429) return new AIError('AIの利用上限か、混み合っています。少し待ってください', `HTTP ${status} ${msg}`, status);
    if([500, 502, 503, 504, 529].includes(status)) return new AIError('AIが混み合っています。少し待ってからもう一度試してください', `HTTP ${status} ${msg}`, status);
    if(status === 400 && /credit|billing|balance|quota/i.test(msg)) return new AIError('APIの残高・請求設定を確認してください', msg, status);
    if(status === 400 && /model/i.test(msg)) return new AIError('モデル名が使えないようです（設定変更のモデル名を確認してください）', msg, status);
    return new AIError('AIでエラーが起きました', `HTTP ${status} ${msg}`, status);
  }
  async function post(url, headers, body, signal){
    let res;
    try{ res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
    catch(e){
      if(e && e.name === 'AbortError') throw e;
      throw new AIError('AIにつながりませんでした。ネット接続を確認してください', e && e.message);
    }
    const data = await res.json().catch(() => null);
    if(!res.ok){
      const m = data && data.error && (data.error.message || data.error.status) || '';
      throw httpErr(res.status, typeof m === 'string' ? m : JSON.stringify(m));
    }
    if(!data) throw new AIError('AIの返答を読めませんでした', 'empty body');
    return data;
  }
  function parseJson(text){
    const t = String(text || '').replace(/```(?:json)?/gi, '');
    const ia = t.indexOf('{'), ib = t.lastIndexOf('}'), ja = t.indexOf('['), jb = t.lastIndexOf(']');
    const useArr = ja >= 0 && (ia < 0 || ja < ia);
    const a = useArr ? ja : ia, b = useArr ? jb : ib;
    if(a < 0 || b <= a) throw new AIError('AIの返答の形がおかしかったので、もう一度試してください', 'JSONが見つかりません');
    try{ return JSON.parse(t.slice(a, b + 1)); }
    catch(e){ throw new AIError('AIの返答の形がおかしかったので、もう一度試してください', e.message); }
  }

  async function claude(c, o){
    const headers = { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    const messages = [{ role: 'user', content: o.prompt }];
    const body = { model: c.model, max_tokens: o.maxTokens || 2000, messages };
    if(o.system) body.system = o.system;
    if(o.search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' } }];
    const sources = new Set();
    let data = null, text = '';
    for(let turn = 0; turn < 4; turn++){
      data = await post('https://api.anthropic.com/v1/messages', headers, body, o.signal);
      const content = Array.isArray(data.content) ? data.content : [];
      let lastTool = -1;
      content.forEach((b, i) => {
        if(b.type === 'web_search_tool_result'){ lastTool = i; if(Array.isArray(b.content)) b.content.forEach(r => { if(r && r.url) sources.add(r.url); }); }
      });
      text = content.slice(lastTool + 1).filter(b => b.type === 'text').map(b => b.text).join('');
      if(data.stop_reason === 'pause_turn'){ messages.push({ role: 'assistant', content }); continue; }
      break;
    }
    if(data && data.stop_reason === 'max_tokens' && o.json) throw new AIError('AIの返答が長すぎて途中で切れました。もう一度試してください', 'max_tokens');
    return { text, sources };
  }

  async function gemini(c, o){
    const headers = { 'content-type': 'application/json', 'x-goog-api-key': c.key };
    const sources = new Set();
    const viaGenerate = async () => {
      // 思考トークンも上限に数えられるため、余裕を持たせる
      const body = { contents: [{ role: 'user', parts: [{ text: o.prompt }] }], generationConfig: { maxOutputTokens: Math.max(8192, (o.maxTokens || 2000) * 4) } };
      if(o.system) body.systemInstruction = { parts: [{ text: o.system }] };
      if(o.search) body.tools = [{ google_search: {} }];
      const data = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, headers, body, o.signal);
      const cand = (data.candidates || [])[0];
      if(!cand) throw new AIError('AIが返答しませんでした。もう一度試してください', (data.promptFeedback && data.promptFeedback.blockReason) || 'candidates が空');
      (((cand.groundingMetadata || {}).groundingChunks) || []).forEach(g => { if(g.web && g.web.uri) sources.add(g.web.uri); });
      const t = ((cand.content && cand.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
      if(!t) throw new AIError('AIの返答が空でした。もう一度試してください', `finishReason: ${cand.finishReason || '不明'}`);
      return t;
    };
    const viaInteractions = async () => {
      const body = { model: c.model, input: o.prompt };
      if(o.system) body.system_instruction = o.system;
      if(o.search) body.tools = [{ type: 'google_search' }];
      const data = await post('https://generativelanguage.googleapis.com/v1beta/interactions', headers, body, o.signal);
      if(data.status && data.status !== 'completed' && ['failed', 'cancelled', 'incomplete'].includes(data.status))
        throw new AIError('AIの生成が途中で止まりました。もう一度試してください', (data.errors || []).map(e => e.message).join(' / ') || data.status);
      let t = '';
      const steps = Array.isArray(data.steps) ? data.steps : Array.isArray(data.outputs) ? data.outputs : [];
      steps.forEach(s => {
        const cs = Array.isArray(s && s.content) ? s.content : (s && s.type === 'text' ? [s] : []);
        cs.forEach(x => { if(x && x.type === 'text' && typeof x.text === 'string'){ t += x.text; (x.annotations || []).forEach(a => { if(a && a.url) sources.add(a.url); }); } });
      });
      return t;
    };
    // 通常は generateContent。使えない場合（404）は Interactions API で再試行
    let text;
    try{ text = await viaGenerate(); }
    catch(e){ if(!(e instanceof AIError) || e.status !== 404) throw e; text = await viaInteractions(); }
    return { text, sources };
  }

  async function ask(o = {}){
    const c = current();
    if(c.via === 'server' && c.needPasscode) throw new AIError('AIを使うには合言葉が必要です（ログインすると不要）。タイトルの「設定変更」で入れてください', 'need passcode');
    if(c.via === 'server' && c.guestOut) throw new AIError(`今日のゲスト利用回数（${c.guest.limit}回）を使い切りました。日本時間の0時にリセットされます。許可されたGoogleアカウントでログインすると無制限です`, 'guest_limit', 429);
    if(!c.ready) throw new AIError(`使用するAI（${c.label}）のAPIキーが未設定です。タイトルの「設定変更」で入れてください`, 'no key');
    const r = c.via === 'server' ? await viaServer(c, o) : c.provider === 'gemini' ? await gemini(c, o) : await claude(c, o);
    if(!r.text) throw new AIError('AIが返答しませんでした。もう一度試してください', 'empty text');
    const used = r.provider || c.provider;
    const out = { text: r.text, sources: r.sources, provider: used, model: r.model || c.model, via: c.via, fallback: !!r.fallback, label: AI_LABEL[used] || c.label };
    if(r.fallback) toast(`${AI_LABEL[c.provider]}が混み合っていたので${AI_LABEL[used]}で作りました`, 2200);
    if(o.json) out.json = parseJson(r.text);
    return out;
  }
  // AIが使えない理由（画面にそのまま出せる短い文）。使えるなら ''
  function reason(){
    const c = current();
    if(c.ready) return '';
    if(c.via === 'server' && c.guestOut) return `今日のゲスト利用回数（${c.guest.limit}回）を使い切りました。ログインすると無制限です`;
    if(c.via === 'server') return '合言葉が未入力です。タイトルの「設定変更」で合言葉を入れるか、ログインするとAIが使えます';
    return `${c.label}のAPIキーが未設定です。タイトルの「設定変更」で入れるとAIが使えます`;
  }
  return { ask, current, reason, parseJson, refreshServer, unlock, lock, login, logout, server, Error: AIError, DEFAULT_MODELS: AI_DEFAULT_MODELS, LABEL: AI_LABEL };
})();
// ページを開くたびにサーバのAI設定を確認（Worker が無ければ何もしない）
if(typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) setTimeout(() => ai.refreshServer(), 0);

/* ---------- 書き出し / 読み込み（手動バックアップ） ---------- */
function exportData(){ return JSON.stringify(DOC, null, 1); }
function importData(text){
  const d = JSON.parse(text);
  if(!d || typeof d !== 'object' || !('records' in d)) throw new Error('あそびばこのデータではありません');
  DOC = mergeDocs(DOC, Object.assign(emptyDoc(), d)); commit('import'); return true;
}

/* ---------- トースト ---------- */
let toastEl = null, toastT = 0;
function toast(msg, ms=1600){
  if(!toastEl){ toastEl = document.createElement('div'); toastEl.className = 'k-toast'; toastEl.setAttribute('role','status'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(()=>toastEl.classList.remove('show'), ms);
}

/* ---------- 確認ダイアログ ---------- */
function confirmBox(msg, {ok='OK', cancel='やめる', danger=false}={}){
  return new Promise(res => {
    const m = document.createElement('div');
    m.className = 'k-modal';
    m.innerHTML = `<div class="k-panel" role="dialog" aria-modal="true">
      <p style="margin:0 0 16px;font-weight:900;font-size:17px;white-space:pre-line"></p>
      <div class="k-grid2"><button class="k-btn" data-v="0"></button><button class="k-btn ${danger?'k-btn--primary':'k-btn--teal'}" data-v="1"></button></div></div>`;
    m.querySelector('p').textContent = msg;
    m.querySelector('[data-v="0"]').textContent = cancel;
    m.querySelector('[data-v="1"]').textContent = ok;
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if(!b && e.target !== m) return;
      const v = b ? b.dataset.v === '1' : false; m.remove(); res(v);
    });
    document.body.appendChild(m);
    m.querySelector('[data-v="1"]').focus();
  });
}

/* ---------- 演出 ---------- */
const FX_COLORS = ['#ff4fa3','#00a3a1','#ffd23f','#3a6fe0','#fffdf7'];
function confetti(canvas, ms=2600){
  const dpr = Math.min(2, window.devicePixelRatio||1);
  const W = canvas.width = innerWidth*dpr, H = canvas.height = innerHeight*dpr;
  const g = canvas.getContext('2d');
  const ps = Array.from({length:140}, (_,i) => ({
    x: W/2 + (Math.random()-.5)*W*.3, y: H*.55,
    vx: (Math.random()-.5)*22*dpr, vy: -(10+Math.random()*16)*dpr,
    r: (4+Math.random()*7)*dpr, a: Math.random()*6, va: (Math.random()-.5)*.4,
    c: FX_COLORS[i%FX_COLORS.length], s: Math.random()<.35 ? 'c' : 'r',
  }));
  const t0 = performance.now();
  (function step(now){
    const t = now - t0; g.clearRect(0,0,W,H);
    ps.forEach(p => {
      p.vy += .55*dpr; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.a += p.va;
      g.save(); g.translate(p.x,p.y); g.rotate(p.a); g.fillStyle = p.c;
      g.strokeStyle = '#1d2440'; g.lineWidth = 1.5*dpr;
      if(p.s==='c'){ g.beginPath(); g.arc(0,0,p.r*.6,0,7); g.fill(); g.stroke(); }
      else { g.fillRect(-p.r/2,-p.r*.3,p.r,p.r*.6); g.strokeRect(-p.r/2,-p.r*.3,p.r,p.r*.6); }
      g.restore();
    });
    if(t < ms) requestAnimationFrame(step);
  })(t0);
}
function showFx({title, sub='', fail=false, ms=2400}={}){
  return new Promise(res => {
    const fx = document.createElement('div');
    fx.className = 'k-fx';
    fx.innerHTML = (fail ? '' : '<canvas></canvas>') + `<div class="k-stamp ${fail?'is-fail':''}"><b></b><small></small></div>`;
    fx.querySelector('b').textContent = title;
    if([...title].length > 5) fx.querySelector('b').style.fontSize = 'clamp(34px,10.5vw,64px)';
    fx.querySelector('small').textContent = sub;
    if(!sub) fx.querySelector('small').remove();
    document.body.appendChild(fx);
    if(fail){ SE.play('fail'); Music.jingle('lose'); }
    else { SE.play('stamp'); setTimeout(()=>SE.play('fanfare'), 120); confetti(fx.querySelector('canvas'), ms); Music.jingle('win'); }
    if(navigator.vibrate) navigator.vibrate(fail ? [200] : [40,40,80]);
    const done = () => { fx.classList.add('out'); setTimeout(()=>{ fx.remove(); res(); }, 350); };
    const t = setTimeout(done, ms);
    fx.style.pointerEvents = 'auto';
    fx.addEventListener('click', () => { clearTimeout(t); done(); }, {once:true});
  });
}
const celebrate = (o={}) => showFx({title:o.title||'クリア!', sub:o.sub, ms:o.ms});
const fail = (o={}) => showFx({title:o.title||'ざんねん', sub:o.sub, fail:true, ms:o.ms||1800});
function shake(el){ el.classList.remove('k-shake'); void el.offsetWidth; el.classList.add('k-shake'); }

/* ---------- 画面切替 ---------- */
function screen(id){
  document.querySelectorAll('.k-screen').forEach(s => s.classList.toggle('is-active', s.id === id));
  window.scrollTo(0,0);
}

/* ---------- アイコン ---------- */
const ICON = {
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/></svg>',
  on:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  off:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>',
};

/* ---------- トップバー（ホーム + タイトル + 音） ---------- */
let current = null;
function mount({id, title, onSave, home='../../index.html'}){
  current = {id, onSave, home};
  Music.bgm('play'); // ミニゲーム中の曲
  const bar = document.createElement('header');
  bar.className = 'k-bar';
  bar.innerHTML = `
    <button class="k-iconbtn k-home" type="button" data-se="none" aria-label="セーブしてホームに戻る">${ICON.home}<span>ホーム</span></button>
    <div class="k-bar__title"></div>
    <button class="k-iconbtn k-sound" type="button" data-se="none" aria-label="音（音楽・効果音）のオンオフ"></button>`;
  bar.querySelector('.k-bar__title').textContent = title;
  const snd = bar.querySelector('.k-sound');
  const drawSnd = () => { snd.innerHTML = SE.muted ? ICON.off : ICON.on; snd.setAttribute('aria-pressed', String(!SE.muted)); };
  drawSnd();
  snd.addEventListener('click', () => { SE.setMuted(!SE.muted); drawSnd(); SE.play('pop'); toast(SE.muted ? '音オフ' : '音オン', 900); });
  onChange(r => { if(r === 'settings') drawSnd(); });
  bar.querySelector('.k-home').addEventListener('click', goHome);
  document.body.prepend(bar);
  // タブを閉じた・アプリを切り替えたときも進行を保存
  window.addEventListener('pagehide', () => persist(false));
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') persist(false); });
  return bar;
}
function persist(){
  if(!current || !current.onSave) return null;
  let data = null;
  try{ data = current.onSave(); }catch(e){ console.warn(e); }
  if(data == null){ clearSave(current.id); return false; }
  const ok = save(current.id, data);
  if(!ok){ // 容量不足（絵の画像など）
    if(data && typeof data === 'object' && data.__lite){ save(current.id, data.__lite()); }
  }
  return true;
}
async function goHome(){
  SE.play('save');
  const saved = persist();
  toast(saved ? 'セーブしました' : 'ホームに戻ります', 800);
  current.leaving = true;
  const wait = new Promise(r => setTimeout(r, 420));
  // クラウド接続中は送信を待つ（最大2.5秒）
  const up = Cloud.status().connected ? Promise.race([Cloud.sync(), new Promise(r => setTimeout(r, 2500))]) : null;
  await Promise.all([wait, up]);
  location.href = current.home;
}

/* すべての .k-btn / .k-seg button に押下音 */
document.addEventListener('click', e => {
  const b = e.target.closest('button, .k-btn');
  if(!b || b.disabled || b.dataset.se === 'none') return;
  SE.play(b.dataset.se || 'click');
}, true);
document.addEventListener('pointerdown', () => SE.unlock(), {once:true});

window.Kit = { SE, store, save, load, saveInfo, clearSave, best, toast, confirm: confirmBox,
  celebrate, fail, shake, screen, mount, goHome, persist, ICON,
  settings, profile, players, mainName, record, records, deleteRecords, newGroup,
  cloud: Cloud, onChange, ai, music: Music, exportData, importData, _mergeDocs: mergeDocs };
})();
