/* =========================================================
   あそびばこ 共通キット
   効果音 / セーブ / ホームボタン / クリア演出 / トースト / 確認
   ========================================================= */
(function(){
'use strict';
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
function emptyDoc(){ return { v:1, profile:{ main:'', friends:[], at:0 }, saves:{}, best:{}, records:[] }; }
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
const SETTINGS_DEFAULT = { volume: 0.7, muted: false, partySize: 3, keys: { claude:'', gemini:'' } };
const settings = {
  get(){ const s = store.get('settings', {}); return Object.assign({}, SETTINGS_DEFAULT, s, { keys: Object.assign({}, SETTINGS_DEFAULT.keys, s.keys||{}) }); },
  set(patch){
    const cur = settings.get();
    const prevKeys = cur.keys;
    const next = Object.assign(cur, patch);
    if(patch.keys) next.keys = Object.assign({}, prevKeys, patch.keys);
    store.set('settings', next);
    if('volume' in patch || 'muted' in patch) SE._apply();
    listeners.forEach(fn => { try{ fn('settings'); }catch(e){} });
    return next;
  },
};
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
  for(let i=0, k=1; i<n; i++){
    let name = list[i];
    while(!name){ const c = `プレイヤー${k++}`; if(!seen.has(c)){ seen.add(c); name = c; } }
    out.push(name);
  }
  return out;
}

/* ---------- 成績 ---------- */
// result: 'win' | 'lose' | 'clear' | 'fail' | 'play'
function record(r){
  if(!r || !r.game) return null;
  const rec = { id: uid(), at: now(), game: r.game, player: String(r.player || mainName()).slice(0, 12),
    result: r.result || 'play' };
  if(r.score != null && isFinite(r.score)) rec.score = Number(r.score);
  if(r.detail) rec.detail = String(r.detail).slice(0, 80);
  if(r.group) rec.group = String(r.group).slice(0, 40); // 同じ対戦の記録を束ねるID
  DOC.records.push(rec);
  if(DOC.records.length > 3000) DOC.records = DOC.records.slice(-3000);
  commit('record');
  return rec;
}
function records(filter={}){
  return DOC.records.filter(r => (!filter.game || r.game === filter.game) && (!filter.player || r.player === filter.player));
}
function deleteRecords(pred){ const before = DOC.records.length; DOC.records = DOC.records.filter(r => !pred(r)); if(DOC.records.length !== before) commit('record'); }
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
    get muted(){ return muted; },
    setMuted(v){ settings.set({ muted: !!v }); },
    _apply(){ muted = !!settings.get().muted; if(master) master.gain.value = vol(); },
  };
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
  const seen = new Map();
  [...(a.records||[]), ...(b.records||[])].forEach(r => { if(r && r.id && !seen.has(r.id)) seen.set(r.id, r); });
  out.records = [...seen.values()].sort((p, q) => p.at - q.at).slice(-3000);
  return out;
}
const Cloud = (() => {
  let timer = 0, busy = false;
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
    if(c.provider !== 'gist' || !c.token || busy) return { ok: false, skipped: true };
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
    }finally{ busy = false; }
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
    if(fail){ SE.play('fail'); }
    else { SE.play('stamp'); setTimeout(()=>SE.play('fanfare'), 120); confetti(fx.querySelector('canvas'), ms); }
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
  const bar = document.createElement('header');
  bar.className = 'k-bar';
  bar.innerHTML = `
    <button class="k-iconbtn k-home" type="button" data-se="none" aria-label="セーブしてホームに戻る">${ICON.home}<span>ホーム</span></button>
    <div class="k-bar__title"></div>
    <button class="k-iconbtn k-sound" type="button" data-se="none" aria-label="効果音のオンオフ"></button>`;
  bar.querySelector('.k-bar__title').textContent = title;
  const snd = bar.querySelector('.k-sound');
  const drawSnd = () => { snd.innerHTML = SE.muted ? ICON.off : ICON.on; snd.setAttribute('aria-pressed', String(!SE.muted)); };
  drawSnd();
  snd.addEventListener('click', () => { SE.setMuted(!SE.muted); drawSnd(); SE.play('pop'); toast(SE.muted ? '効果音オフ' : '効果音オン', 900); });
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
  cloud: Cloud, onChange, exportData, importData, _mergeDocs: mergeDocs };
})();
