/* =========================================================
   あそびばこ — Cloudflare Worker
   - /api/config : サーバに登録されたAIの有無・モデル名（秘密は返さない）
   - /api/auth   : 合言葉の確認
   - /api/login  : Googleログイン（許可したGmailだけ。ログイン中はAI無制限）
   - /api/logout : ログアウト
   - /api/ai     : サーバのAPIキーで Claude / Gemini に中継
                   ログイン中 → 無制限 ／ ログインなし → 合言葉＋サイト全体で1日 GUEST_DAILY_LIMIT 回まで
   - それ以外    : public/ の静的ファイル（env.ASSETS）
   環境変数（Cloudflare の Worker → Settings → Variables and Secrets）
     Secret : GAME_PASSCODE, CLAUDE_API_KEY, GEMINI_API_KEY, SESSION_SECRET
     Text   : AI_PROVIDER（claude|gemini）, CLAUDE_MODEL, GEMINI_MODEL,
              GOOGLE_CLIENT_ID, ALLOWED_EMAILS（カンマ区切り）, GUEST_DAILY_LIMIT（初期30）
   ========================================================= */

const DEFAULT_MODELS = { claude: 'claude-sonnet-5-5', gemini: 'gemini-3.5-flash-lite' };
const MAX_PROMPT = 20000, MAX_SYSTEM = 4000, MAX_TOKENS = 8000;

// 合言葉の総当たり対策（同じ isolate 内での簡易的な制限。主な防御は Cloudflare Access）
const fails = new Map(); // ip -> { n, until }
const LOCK_AFTER = 8, LOCK_MS = 5 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/config' && request.method === 'GET') return config(request, env);
      if (url.pathname === '/api/auth' && request.method === 'POST') return auth(request, env);
      if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env);
      if (url.pathname === '/api/logout' && request.method === 'POST') return logout(request);
      if (url.pathname === '/api/ai' && request.method === 'POST') return ai(request, env);
      return json({ error: { message: '見つかりません' } }, 404);
    } catch (e) {
      return json({ error: { message: 'サーバでエラーが起きました', detail: String(e && e.message || e) } }, 500);
    }
  },
};

/* ---------- 共通 ---------- */
function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extraHeaders),
  });
}
const str = v => (typeof v === 'string' ? v.trim() : '');
const providerOf = (v, env) => (v === 'gemini' || v === 'claude') ? v : (str(env.AI_PROVIDER) === 'gemini' ? 'gemini' : 'claude');
const modelOf = (p, env) => str(p === 'gemini' ? env.GEMINI_MODEL : env.CLAUDE_MODEL) || DEFAULT_MODELS[p];
const keyOf = (p, env) => str(p === 'gemini' ? env.GEMINI_API_KEY : env.CLAUDE_API_KEY);

async function sameText(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ax = new Uint8Array(x), ay = new Uint8Array(y);
  let d = 0; for (let i = 0; i < ax.length; i++) d |= ax[i] ^ ay[i];
  return d === 0;
}
function clientIp(request) { return request.headers.get('cf-connecting-ip') || 'local'; }

// 合言葉を確認。NG なら Response を返す
async function checkPasscode(request, env, given) {
  const want = str(env.GAME_PASSCODE);
  if (!want) return json({ error: { message: 'サーバの合言葉が未設定です（Cloudflare に GAME_PASSCODE を登録してください）', code: 'no_passcode' } }, 503);
  const ip = clientIp(request), now = Date.now(), f = fails.get(ip);
  if (f && f.until > now) return json({ error: { message: '合言葉を何度も間違えたため、しばらく使えません。5分ほど待ってください', code: 'locked' } }, 429);
  if (!given || !(await sameText(str(given), want))) {
    const expired = f && f.until && f.until <= now; // ロック明けは数え直し
    const n = (f && !expired ? f.n : 0) + 1;
    fails.set(ip, { n, until: n >= LOCK_AFTER ? now + LOCK_MS : 0 });
    await new Promise(r => setTimeout(r, 600)); // 連打をにぶらせる
    return json({ error: { message: '合言葉が違います', code: 'bad_passcode' } }, 401);
  }
  fails.delete(ip);
  return null;
}

/* =========================================================
   ログイン（Google）とセッション
   ========================================================= */
const SESSION_COOKIE = 'asb_s', SESSION_DAYS = 30;
const loginEnabled = env => !!(str(env.GOOGLE_CLIENT_ID) && str(env.SESSION_SECRET));
const allowed = env => str(env.ALLOWED_EMAILS).toLowerCase().split(/[\s,]+/).filter(Boolean);
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const utf8 = s => new TextEncoder().encode(s);

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', utf8(str(env.SESSION_SECRET)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function makeSession(env, email) {
  const payload = b64u(utf8(JSON.stringify({ e: email, x: Date.now() + SESSION_DAYS * 864e5 })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), utf8(payload)));
  return `${payload}.${sig}`;
}
function readCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}
// ログイン中なら { email }、そうでなければ null
async function sessionUser(request, env) {
  if (!loginEnabled(env)) return null;
  const v = readCookie(request, SESSION_COOKIE);
  const [payload, sig] = v.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), utf8(payload));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    if (!p.e || !p.x || p.x < Date.now()) return null;
    if (!allowed(env).includes(String(p.e).toLowerCase())) return null; // 許可リストから外されたら即無効
    return { email: p.e };
  } catch (e) { return null; }
}
function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// Google の IDトークン（JWT, RS256）を検証
let jwksCache = { at: 0, keys: [] };
async function googleKeys(env, force) {
  if (!force && jwksCache.keys.length && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys;
  const res = await fetch(str(env.GOOGLE_CERTS_URL) || 'https://www.googleapis.com/oauth2/v3/certs');
  const data = await res.json();
  jwksCache = { at: Date.now(), keys: Array.isArray(data.keys) ? data.keys : [] };
  return jwksCache.keys;
}
async function verifyGoogleToken(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('トークンの形が違います');
  const header = JSON.parse(new TextDecoder().decode(unb64u(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1])));
  if (header.alg !== 'RS256') throw new Error('署名方式が違います');
  let jwk = (await googleKeys(env)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(env, true)).find(k => k.kid === header.kid); // 鍵の入れ替わり
  if (!jwk) throw new Error('署名の鍵が見つかりません');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(parts[2]), utf8(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('署名が正しくありません');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('発行元が違います');
  if (claims.aud !== str(env.GOOGLE_CLIENT_ID)) throw new Error('このサイト向けのトークンではありません');
  if (!claims.exp || claims.exp * 1000 < Date.now() - 60e3) throw new Error('トークンの期限切れです');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('メールアドレスが確認されていません');
  return { email: String(claims.email || '').toLowerCase(), name: claims.name || '' };
}

/* ---------- /api/login ・ /api/logout ---------- */
async function login(request, env) {
  if (!loginEnabled(env)) return json({ error: { message: 'ログインは設定されていません' } }, 503);
  const b = await request.json().catch(() => ({}));
  let who;
  try { who = await verifyGoogleToken(b && b.credential, env); }
  catch (e) { return json({ error: { message: 'Googleログインを確認できませんでした', detail: e.message } }, 401); }
  if (!allowed(env).includes(who.email)) {
    return json({ error: { message: `${who.email} は無制限の対象ではありません。ゲストとして遊べます`, code: 'not_allowed' } }, 403);
  }
  const token = await makeSession(env, who.email);
  return json({ ok: true, email: who.email }, 200, { 'set-cookie': cookieHeader(request, token, SESSION_DAYS * 86400) });
}
function logout(request) {
  return json({ ok: true }, 200, { 'set-cookie': cookieHeader(request, '', 0) });
}

/* =========================================================
   ゲストの利用回数（サイト全体で1日◯回。日本時間の0時にリセット）
   ========================================================= */
const guestLimit = env => { const n = parseInt(str(env.GUEST_DAILY_LIMIT), 10); return n >= 0 ? n : 30; };
const jstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
async function usage(env, op) {
  if (!env.USAGE) return { ok: false, used: 0, error: 'no_counter' };
  const stub = env.USAGE.get(env.USAGE.idFromName('guest'));
  const res = await stub.fetch('https://usage/' + op, { method: 'POST', body: JSON.stringify({ day: jstDay(), limit: guestLimit(env) }) });
  return res.json();
}

// 1日の回数を数える Durable Object（1つだけ使う。処理が1つずつ順に走るので数え漏れがない）
export class UsageCounter {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    const { day, limit } = await request.json();
    let rec = (await this.state.storage.get('rec')) || { day, n: 0 };
    if (rec.day !== day) rec = { day, n: 0 }; // 日付が変わったらリセット
    if (op === 'take') {
      if (rec.n >= limit) return Response.json({ ok: false, used: rec.n, limit });
      rec.n++; await this.state.storage.put('rec', rec);
      return Response.json({ ok: true, used: rec.n, limit });
    }
    if (op === 'refund') { rec.n = Math.max(0, rec.n - 1); await this.state.storage.put('rec', rec); }
    return Response.json({ ok: true, used: rec.n, limit });
  }
}

/* ---------- /api/config ---------- */
async function config(request, env) {
  const user = await sessionUser(request, env);
  const limit = guestLimit(env);
  let used = 0;
  try { used = (await usage(env, 'get')).used || 0; } catch (e) {}
  return json({
    provider: providerOf('', env),
    server: { claude: !!keyOf('claude', env), gemini: !!keyOf('gemini', env) },
    models: { claude: modelOf('claude', env), gemini: modelOf('gemini', env) },
    passcode: !!str(env.GAME_PASSCODE),
    login: { enabled: loginEnabled(env), clientId: loginEnabled(env) ? str(env.GOOGLE_CLIENT_ID) : '' },
    user: user ? { email: user.email, unlimited: true } : null,
    guest: { limit, used, remaining: Math.max(0, limit - used) },
  });
}

/* ---------- /api/auth ---------- */
async function auth(request, env) {
  const body = await request.json().catch(() => ({}));
  const ng = await checkPasscode(request, env, body && body.passcode);
  return ng || json({ ok: true });
}

/* ---------- /api/ai ---------- */
async function ai(request, env) {
  // ログイン中（許可したGmail）は合言葉も回数制限もなし
  const user = await sessionUser(request, env);
  if (!user) {
    const ng = await checkPasscode(request, env, request.headers.get('x-game-passcode'));
    if (ng) return ng;
  }
  const b = await request.json().catch(() => null);
  if (!b || typeof b.prompt !== 'string' || !b.prompt.trim()) return json({ error: { message: 'リクエストの形がおかしいです' } }, 400);
  if (b.prompt.length > MAX_PROMPT || (b.system && String(b.system).length > MAX_SYSTEM)) return json({ error: { message: 'リクエストが長すぎます' } }, 413);
  const provider = providerOf(b.provider, env);
  const key = keyOf(provider, env);
  if (!key) return json({ error: { message: `サーバに ${provider === 'gemini' ? 'Gemini' : 'Claude'} のAPIキーが登録されていません`, code: 'no_server_key' } }, 503);
  const o = {
    key, model: modelOf(provider, env),
    system: b.system ? String(b.system) : '',
    prompt: b.prompt,
    maxTokens: Math.max(1, Math.min(MAX_TOKENS, Math.round(+b.maxTokens) || 2000)),
    search: !!b.search,
  };
  // ゲストはサイト全体の1日の回数から1回分を確保（失敗したら返す）
  let taken = null;
  if (!user) {
    taken = await usage(env, 'take').catch(() => ({ ok: false, error: 'counter' }));
    if (!taken.ok) {
      if (taken.error) return json({ error: { message: '利用回数を確認できませんでした。少し待ってからもう一度試してください', code: 'counter' } }, 503);
      return json({ error: { message: `今日のゲスト利用回数（${taken.limit}回）を使い切りました。日本時間の0時にリセットされます。許可されたGoogleアカウントでログインすると無制限です`, code: 'guest_limit' } }, 429);
    }
  }
  // 1) 混雑系のエラーは少し待って再試行
  let used = provider, r = await withRetry(() => (provider === 'gemini' ? callGemini(o, env) : callClaude(o, env)));
  // 2) それでもダメなら、もう一方のAI（サーバにキーがあれば）に切り替える。AI_FALLBACK="off" で無効
  const other = provider === 'gemini' ? 'claude' : 'gemini';
  if (r.error && BUSY.has(r.status) && str(env.AI_FALLBACK) !== 'off' && keyOf(other, env)) {
    const o2 = Object.assign({}, o, { key: keyOf(other, env), model: modelOf(other, env) });
    const r2 = await withRetry(() => (other === 'gemini' ? callGemini(o2, env) : callClaude(o2, env)), 1);
    if (!r2.error) { used = other; r = r2; o.model = o2.model; }
  }
  if (r.error) {
    if (taken) await usage(env, 'refund').catch(() => {}); // 失敗した分は数えない
    if (BUSY.has(r.status)) r.error.message = 'AIが混み合っています。少し待ってからもう一度試してください';
    return json({ error: r.error }, r.status || 502);
  }
  const quota = user ? { unlimited: true } : { limit: taken.limit, used: taken.used, remaining: Math.max(0, taken.limit - taken.used) };
  return json({ text: r.text, sources: [...r.sources], provider: used, model: o.model, fallback: used !== provider, stop: r.stop || '', quota });
}

// 混雑・一時的な障害（Anthropic の過負荷は 529）
const BUSY = new Set([429, 500, 502, 503, 504, 529]);
async function withRetry(fn, retries = 2) {
  let r = await fn();
  for (let i = 0; i < retries && r.error && BUSY.has(r.status); i++) {
    await new Promise(res => setTimeout(res, 1200 * (i + 1) + Math.random() * 400));
    r = await fn();
  }
  return r;
}

async function post(url, headers, body) {
  let res;
  try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (e) { return { error: { message: 'AIのサーバにつながりませんでした', detail: String(e && e.message || e) }, status: 502 }; }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const m = data && data.error && (data.error.message || data.error.status) || '';
    return { error: { message: 'AIでエラーが起きました', detail: typeof m === 'string' ? m : JSON.stringify(m), upstream: res.status }, status: res.status };
  }
  if (!data) return { error: { message: 'AIの返答を読めませんでした' }, status: 502 };
  return { data };
}

/* Claude Messages API（search のときは web_search ツール。pause_turn は続きを要求） */
async function callClaude(o, env) {
  const base = str(env.ANTHROPIC_BASE_URL) || 'https://api.anthropic.com';
  const headers = { 'content-type': 'application/json', 'x-api-key': o.key, 'anthropic-version': '2023-06-01' };
  const messages = [{ role: 'user', content: o.prompt }];
  const body = { model: o.model, max_tokens: o.maxTokens, messages };
  if (o.system) body.system = o.system;
  if (o.search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' } }];
  const sources = new Set();
  let text = '', stop = '';
  for (let turn = 0; turn < 4; turn++) {
    const r = await post(`${base}/v1/messages`, headers, body);
    if (r.error) return r;
    const content = Array.isArray(r.data.content) ? r.data.content : [];
    let lastTool = -1;
    content.forEach((c, i) => {
      if (c.type === 'web_search_tool_result') { lastTool = i; if (Array.isArray(c.content)) c.content.forEach(x => { if (x && x.url) sources.add(x.url); }); }
    });
    text = content.slice(lastTool + 1).filter(c => c.type === 'text').map(c => c.text).join('');
    stop = r.data.stop_reason || '';
    if (stop === 'pause_turn') { messages.push({ role: 'assistant', content }); continue; }
    break;
  }
  return { text, sources, stop };
}

/* Gemini（generateContent。404 のときは Interactions API） */
async function callGemini(o, env) {
  const base = str(env.GEMINI_BASE_URL) || 'https://generativelanguage.googleapis.com';
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': o.key };
  const sources = new Set();
  // Gemini は思考トークンも出力上限に数える。小さい上限だと考えるだけで終わって返答が空になるので、余裕を持たせる
  const gen = { contents: [{ role: 'user', parts: [{ text: o.prompt }] }], generationConfig: { maxOutputTokens: Math.max(8192, o.maxTokens * 4) } };
  if (o.system) gen.systemInstruction = { parts: [{ text: o.system }] };
  if (o.search) gen.tools = [{ google_search: {} }];
  let r = await post(`${base}/v1beta/models/${encodeURIComponent(o.model)}:generateContent`, headers, gen);
  if (!r.error) {
    const cand = (r.data.candidates || [])[0];
    const block = r.data.promptFeedback && r.data.promptFeedback.blockReason;
    if (!cand) return { error: { message: block ? 'AIが内容を理由に返答しませんでした' : 'AIが返答しませんでした', detail: block || 'candidates が空' }, status: 502 };
    (((cand.groundingMetadata || {}).groundingChunks) || []).forEach(g => { if (g.web && g.web.uri) sources.add(g.web.uri); });
    const text = ((cand.content && cand.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (!text) return { error: { message: 'AIの返答が空でした。もう一度試してください', detail: `finishReason: ${cand.finishReason || '不明'}` }, status: 502 };
    return { text, sources, stop: cand.finishReason === 'MAX_TOKENS' ? 'max_tokens' : (cand.finishReason || '') };
  }
  if (r.status !== 404) return r;
  const it = { model: o.model, input: o.prompt };
  if (o.system) it.system_instruction = o.system;
  if (o.search) it.tools = [{ type: 'google_search' }];
  r = await post(`${base}/v1beta/interactions`, headers, it);
  if (r.error) return r;
  const d = r.data;
  if (d.status && ['failed', 'cancelled', 'incomplete'].includes(d.status))
    return { error: { message: 'AIの生成が途中で止まりました', detail: (d.errors || []).map(e => e.message).join(' / ') || d.status }, status: 502 };
  let text = '';
  const steps = Array.isArray(d.steps) ? d.steps : Array.isArray(d.outputs) ? d.outputs : [];
  steps.forEach(s => {
    const cs = Array.isArray(s && s.content) ? s.content : (s && s.type === 'text' ? [s] : []);
    cs.forEach(x => { if (x && x.type === 'text' && typeof x.text === 'string') { text += x.text; (x.annotations || []).forEach(a => { if (a && a.url) sources.add(a.url); }); } });
  });
  return { text, sources };
}
