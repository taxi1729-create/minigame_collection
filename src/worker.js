/* =========================================================
   あそびばこ — Cloudflare Worker
   - /api/config : サーバに登録されたAIの有無・モデル名（秘密は返さない）
   - /api/auth   : 合言葉の確認
   - /api/ai     : 合言葉つきのリクエストだけ、サーバのAPIキーで Claude / Gemini に中継
   - それ以外    : public/ の静的ファイル（env.ASSETS）
   環境変数（Cloudflare の Worker → Settings → Variables and Secrets）
     Secret : GAME_PASSCODE, CLAUDE_API_KEY, GEMINI_API_KEY
     Text   : AI_PROVIDER（claude|gemini）, CLAUDE_MODEL, GEMINI_MODEL
   ========================================================= */

const DEFAULT_MODELS = { claude: 'claude-sonnet-5-5', gemini: 'gemini-3.8-flash' };
const MAX_PROMPT = 20000, MAX_SYSTEM = 4000, MAX_TOKENS = 8000;

// 合言葉の総当たり対策（同じ isolate 内での簡易的な制限。主な防御は Cloudflare Access）
const fails = new Map(); // ip -> { n, until }
const LOCK_AFTER = 8, LOCK_MS = 5 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/config' && request.method === 'GET') return config(env);
      if (url.pathname === '/api/auth' && request.method === 'POST') return auth(request, env);
      if (url.pathname === '/api/ai' && request.method === 'POST') return ai(request, env);
      return json({ error: { message: '見つかりません' } }, 404);
    } catch (e) {
      return json({ error: { message: 'サーバでエラーが起きました', detail: String(e && e.message || e) } }, 500);
    }
  },
};

/* ---------- 共通 ---------- */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
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

/* ---------- /api/config ---------- */
function config(env) {
  return json({
    provider: providerOf('', env),
    server: { claude: !!keyOf('claude', env), gemini: !!keyOf('gemini', env) },
    models: { claude: modelOf('claude', env), gemini: modelOf('gemini', env) },
    passcode: !!str(env.GAME_PASSCODE),
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
  const ng = await checkPasscode(request, env, request.headers.get('x-game-passcode'));
  if (ng) return ng;
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
  const r = provider === 'gemini' ? await callGemini(o, env) : await callClaude(o, env);
  if (r.error) return json({ error: r.error }, r.status || 502);
  return json({ text: r.text, sources: [...r.sources], provider, model: o.model, stop: r.stop || '' });
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
  const gen = { contents: [{ role: 'user', parts: [{ text: o.prompt }] }], generationConfig: { maxOutputTokens: o.maxTokens } };
  if (o.system) gen.systemInstruction = { parts: [{ text: o.system }] };
  if (o.search) gen.tools = [{ google_search: {} }];
  let r = await post(`${base}/v1beta/models/${encodeURIComponent(o.model)}:generateContent`, headers, gen);
  if (!r.error) {
    const cand = (r.data.candidates || [])[0];
    if (!cand) return { error: { message: 'AIが返答しませんでした' }, status: 502 };
    (((cand.groundingMetadata || {}).groundingChunks) || []).forEach(g => { if (g.web && g.web.uri) sources.add(g.web.uri); });
    return { text: ((cand.content && cand.content.parts) || []).map(p => p.text || '').join(''), sources, stop: cand.finishReason || '' };
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
