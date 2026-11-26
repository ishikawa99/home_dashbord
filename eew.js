// 緊急地震速報（EEW）の受信と全画面表示。
// 参考表示です。専用の受信機器や、スマホ・テレビ・ラジオの緊急地震速報の代わりにはなりません。
import { JAPAN, CITIES } from './map-data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCALE = { 10: '1', 20: '2', 30: '3', 40: '4', 45: '5弱', 50: '5強', 55: '6弱', 60: '6強', 70: '7' };
const SRC = {
  wolfx: { label: 'Wolfx', url: 'wss://ws-api.wolfx.jp/jma_eew' },
  p2p: { label: 'P2P地震情報', url: 'wss://api.p2pquake.net/v2/ws' }
};

let cfg = null;
const events = new Map();      // 地震ID -> 最新の報
const dismissed = new Map();   // 地震ID -> 閉じた時点の報数
const conn = {}, socks = {}, retry = {}, lastMsg = {}, pingTimer = {};
let shownKey = '', curId = '', curEv = null, lastBeepAt = 0, ac = null;

const num = (v) => (v === '' || v == null ? NaN : Number(v));
function parseJST(s) {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]) : NaN;
}
const okLat = (v) => (Number.isFinite(v) && Math.abs(v) <= 90 && v !== 0 ? v : NaN);
const okLon = (v) => (Number.isFinite(v) && Math.abs(v) <= 180 && v !== 0 ? v : NaN);
const posNum = (v) => (Number.isFinite(v) && v > 0 ? v : NaN);

/* ---------- 受信データの正規化 ---------- */
function parseWolfx(j) {
  if (!j || !j.EventID) return null;
  return {
    id: String(j.EventID), serial: num(j.Serial) || 1, src: 'wolfx',
    warn: !!j.isWarn, cancel: !!j.isCancel, training: !!j.isTraining, assumption: !!j.isAssumption, sea: !!j.isSea, final: !!j.isFinal,
    originMs: parseJST(j.OriginTime), announcedMs: parseJST(j.AnnouncedTime),
    lat: okLat(num(j.Latitude)), lon: okLon(num(j.Longitude)), depth: num(j.Depth), mag: posNum(num(j.Magnitude)),
    maxInt: String(j.MaxIntensity ?? ''), place: String(j.Hypocenter ?? ''),
    areas: (Array.isArray(j.WarnArea) ? j.WarnArea : []).map((a) => ({ name: String(a.Chiiki ?? ''), from: String(a.Shindo1 ?? ''), to: String(a.Shindo2 ?? '') }))
  };
}
function parseP2P(j) {
  if (!j || j.code !== 556) return null;                       // 556 = 緊急地震速報（警報）
  const eq = j.earthquake || {}, hy = eq.hypocenter || {}, id = j.issue?.eventId;
  if (!id) return null;
  const areas = (Array.isArray(j.areas) ? j.areas : []).map((a) => ({
    name: String(a.name ?? ''), pref: String(a.pref ?? ''), from: SCALE[a.scaleFrom] || '', to: a.scaleTo === 99 ? '以上' : (SCALE[a.scaleTo] || '')
  }));
  const top = Math.max(-1, ...(Array.isArray(j.areas) ? j.areas : []).map((a) => (a.scaleTo === 99 ? a.scaleFrom : a.scaleTo) || 0));
  return {
    id: String(id), serial: num(j.issue?.serial) || 1, src: 'p2p',
    warn: true, cancel: !!j.cancelled, training: !!j.test, assumption: false, sea: false, final: false,
    originMs: parseJST(eq.originTime), announcedMs: parseJST(j.issue?.time),
    lat: okLat(num(hy.latitude)), lon: okLon(num(hy.longitude)), depth: hy.depth >= 0 ? num(hy.depth) : NaN, mag: posNum(num(hy.magnitude)),
    maxInt: SCALE[top] || '', place: String(hy.name ?? ''), areas
  };
}

/* ---------- 地震の保持（重複除去・期限） ---------- */
function endMsOf(ev) {
  if (ev.cancel) return (ev.cancelAt || ev.receivedAt) + 30000;
  const o = Number.isFinite(ev.originMs) ? ev.originMs : ev.receivedAt;
  let sAt = o + 120000;
  if (Number.isFinite(ev.lat)) {
    const R = Math.hypot(distKm(ev.lat, ev.lon, cfg.home.lat, cfg.home.lon), Number.isFinite(ev.depth) ? ev.depth : 10);
    sAt = o + (R / cfg.vs) * 1000;
  }
  return Math.min(o + 600000, Math.max(o + 150000, sAt + 90000));
}
function upsert(ev) {
  const now = Date.now();
  if (ev.training && !cfg.showTraining) return;
  const ref = Number.isFinite(ev.originMs) ? ev.originMs : ev.announcedMs;
  if (Number.isFinite(ref) && now > ref + 600000) return;          // 接続直後に再送される古い報は無視
  const prev = events.get(ev.id);
  ev.receivedAt = now;
  if (prev) {
    if (ev.serial < prev.serial) return;
    if (ev.serial === prev.serial && ev.cancel === prev.cancel) {   // 別の配信元からの同じ報：不足分だけ補う
      prev.warn = prev.warn || ev.warn;
      if (!prev.areas?.length && ev.areas?.length) prev.areas = ev.areas;
      if (!prev.maxInt && ev.maxInt) prev.maxInt = ev.maxInt;
      return;
    }
    if (ev.cancel) { events.set(ev.id, { ...prev, ...pickDefined(ev), cancel: true, cancelAt: now, updatedAt: now, serial: Math.max(ev.serial, prev.serial) }); return; }
  }
  ev.updatedAt = now;
  events.set(ev.id, ev);
  dismissed.delete(ev.id);
}
const pickDefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => !(typeof v === 'number' && Number.isNaN(v)) && v !== '' && !(Array.isArray(v) && !v.length)));

/* ---------- 地理計算 ---------- */
const R_EARTH = 6371;
const d2r = Math.PI / 180;
function distKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * d2r) / 2) ** 2 + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(((lon2 - lon1) * d2r) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
// 震源を中心とした正距方位図法（震源からの距離が正確で、波面が真円になる）
function project(lon, lat, c) {
  const p = lat * d2r, p0 = c.lat * d2r, dl = (lon - c.lon) * d2r;
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl);
  const cc = Math.acos(Math.min(1, Math.max(-1, cosc)));
  const k = cc < 1e-9 ? 1 : cc / Math.sin(cc);
  return { x: R_EARTH * k * Math.cos(p) * Math.sin(dl), y: -R_EARTH * k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl)) };
}
const surfaceR = (v, tSec, depth) => { const r = v * tSec; return r > depth ? Math.sqrt(r * r - depth * depth) : 0; };

/* ---------- 接続（WebSocket） ---------- */
function connect(name) {
  clearTimeout(retry[name]?.timer);
  retry[name] ||= { n: 0, timer: 0 };
  let ws;
  try { ws = new WebSocket(SRC[name].url); } catch { scheduleRetry(name); return; }
  socks[name] = ws;
  ws.onopen = () => {
    conn[name] = true; retry[name].n = 0; lastMsg[name] = Date.now(); cfg.onStatus?.();
    clearInterval(pingTimer[name]);
    if (name === 'wolfx') pingTimer[name] = setInterval(() => { try { ws.send('ping'); } catch { /* 切断時は再接続される */ } }, 50000);
  };
  ws.onmessage = (e) => { lastMsg[name] = Date.now(); handle(name, e.data, ws); };
  const down = () => {
    if (socks[name] !== ws) return;
    conn[name] = false; clearInterval(pingTimer[name]); cfg.onStatus?.(); scheduleRetry(name);
  };
  ws.onclose = down; ws.onerror = down;
}
function scheduleRetry(name) {
  const r = retry[name];
  clearTimeout(r.timer);
  r.timer = setTimeout(() => connect(name), Math.min(60000, 2000 * 2 ** Math.min(r.n++, 5)));
}
function handle(name, data, ws) {
  let j;
  try { j = JSON.parse(data); } catch { return; }
  if (name === 'wolfx' && j?.type === 'heartbeat') { try { ws.send('ping'); } catch { /* noop */ } return; }
  const ev = name === 'wolfx' ? parseWolfx(j) : parseP2P(j);
  if (ev) upsert(ev);
}

/* ---------- 音（端末の制限により、起動後に一度画面に触れていないと鳴りません） ---------- */
function unlockAudio() {
  try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); ac.resume?.(); } catch { /* 音なしで動作 */ }
}
function beep(warn) {
  if (!ac || ac.state !== 'running' || !cfg.sound()) return;
  const n = warn ? 3 : 1, f = warn ? 1000 : 700;
  for (let i = 0; i < n; i++) {
    const t0 = ac.currentTime + i * 0.28, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 0.22);
  }
}

/* ---------- 画面 ---------- */
function homeIntensity(ev) {
  const keys = cfg.homeAreas || [];
  const a = (ev.areas || []).find((x) => keys.some((k) => (x.name || '').includes(k) || (x.pref || '').includes(k)));
  if (!a || !a.from) return '';
  return !a.to || a.to === a.from ? a.from : a.to === '以上' ? `${a.from}以上` : `${a.from}〜${a.to}`;
}
function buildMap(ev) {
  const svg = $('#eew-svg');
  if (!Number.isFinite(ev.lat)) { svg.innerHTML = ''; return; }
  const c = { lat: ev.lat, lon: ev.lon }, H = project(cfg.home.lon, cfg.home.lat, c), dist = Math.hypot(H.x, H.y);
  const box = $('#eew-map').getBoundingClientRect(), aspect = box.width > 20 && box.height > 20 ? box.width / box.height : 1.4;
  let half = Math.max(200, dist * 0.65 + 110);
  half = Math.max(half, (dist * 1.35) / (2 * aspect));
  const w = 2 * half * aspect, h = 2 * half, cx = H.x / 2, cy = H.y / 2;
  svg.setAttribute('viewBox', `${(cx - w / 2).toFixed(1)} ${(cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  const fs = half / 13;
  const land = JAPAN.map((ring) => 'M' + ring.map(([lo, la]) => { const p = project(lo, la, c); return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join('L') + 'Z').join('');
  const inView = (p) => Math.abs(p.x - cx) < w / 2 - fs && Math.abs(p.y - cy) < h / 2 - fs;
  const cities = CITIES.map(([n, lo, la]) => ({ n, p: project(lo, la, c) })).filter((x) => inView(x.p))
    .map((x) => `<circle cx="${x.p.x.toFixed(1)}" cy="${x.p.y.toFixed(1)}" r="${fs * 0.13}" class="city"/><text x="${(x.p.x + fs * 0.3).toFixed(1)}" y="${(x.p.y + fs * 0.3).toFixed(1)}" font-size="${fs * 0.8}" class="cityn">${x.n}</text>`).join('');
  const x0 = fs * 0.55;
  svg.innerHTML =
    `<path d="${land}" class="land" vector-effect="non-scaling-stroke"/>${cities}` +
    '<circle id="wS" class="ws" cx="0" cy="0" r="0" vector-effect="non-scaling-stroke"/><circle id="wP" class="wp" cx="0" cy="0" r="0" vector-effect="non-scaling-stroke"/>' +
    `<g class="epi" stroke-width="${fs * 0.22}"><line x1="${-x0}" y1="${-x0}" x2="${x0}" y2="${x0}"/><line x1="${-x0}" y1="${x0}" x2="${x0}" y2="${-x0}"/></g>` +
    `<circle cx="${H.x.toFixed(1)}" cy="${H.y.toFixed(1)}" r="${fs * 0.42}" class="home" vector-effect="non-scaling-stroke"/>` +
    `<text x="${(H.x + fs * 0.7).toFixed(1)}" y="${(H.y + fs * 0.35).toFixed(1)}" font-size="${fs}" class="homen">${esc(cfg.home.short || cfg.home.name)}</text>`;
}
function fillStatic(ev) {
  const kind = ev.cancel ? 'cancel' : ev.warn ? 'warn' : 'info';
  $('#eew-head').className = kind;
  $('#eew-kind').textContent = ev.cancel ? '緊急地震速報 キャンセル' : ev.warn ? '緊急地震速報（警報）' : '緊急地震速報（予報）';
  $('#eew-meta').textContent = `第${ev.serial}報${ev.final ? '（最終）' : ''}${ev.src === 'test' ? '　テスト表示' : ''}`;
  $('#eew-place').textContent = ev.place || '震源を調査中';
  const facts = [];
  if (Number.isFinite(ev.mag)) facts.push(`M${ev.mag.toFixed(1)}`);
  if (Number.isFinite(ev.depth) && ev.depth > 0) facts.push(`深さ${Math.round(ev.depth)}km`);
  if (ev.maxInt && ev.maxInt !== '不明') facts.push(`最大震度${ev.maxInt}と予想`);
  $('#eew-facts').textContent = facts.join('　') || '詳細を取得中';
  const hi = homeIntensity(ev);
  $('#eew-home').textContent = ev.cancel ? '先ほどの速報は取り消されました' : `${cfg.home.short || cfg.home.name}の予想震度：${hi ? '震度' + hi : '情報なし'}`;
  const notes = [];
  if (ev.assumption) notes.push('震源を仮定した推定のため、精度が低い可能性があります。');
  if (ev.sea) notes.push('震源は海域です。');
  if (!Number.isFinite(ev.lat)) notes.push('震源の位置が未確定のため、地図と到達時間は表示できません。');
  notes.push(ev.cancel ? '' : 'まず身の安全を確保してください。参考表示です。');
  $('#eew-note').textContent = notes.filter(Boolean).join(' ');
  document.querySelectorAll('#eew .cd').forEach((n) => { n.hidden = ev.cancel; });
}
function render(ev, now, extra) {
  const root = $('#eew');
  if (root.hidden) { root.hidden = false; document.body.classList.add('eew-on'); shownKey = ''; }
  const key = `${ev.id}:${ev.serial}:${ev.cancel}:${ev.warn}`;
  if (key !== shownKey) { shownKey = key; curId = ev.id; curEv = ev; fillStatic(ev); buildMap(ev); lastBeepAt = 0; }
  if (extra) $('#eew-meta').textContent = $('#eew-meta').textContent.replace(/　ほか.*$/, '') + `　ほか${extra}件の速報あり`;
  let tS = Infinity;
  if (Number.isFinite(ev.lat) && Number.isFinite(ev.originMs) && !ev.cancel) {
    const depth = Number.isFinite(ev.depth) && ev.depth >= 0 ? ev.depth : 10;
    const R = Math.hypot(distKm(ev.lat, ev.lon, cfg.home.lat, cfg.home.lon), depth);
    const t = (now - ev.originMs) / 1000;
    const tP = ev.originMs + (R / cfg.vp) * 1000 - now;
    tS = ev.originMs + (R / cfg.vs) * 1000 - now;
    const setCd = (id, ms) => { const done = ms <= 0; $(`#${id}`).textContent = done ? '到達' : String(Math.ceil(ms / 1000)); $(`#${id}-u`).textContent = done ? '' : '秒'; $(`#${id}`).parentElement.classList.toggle('done', done); };
    setCd('cd-p', tP); setCd('cd-s', tS);
    $('#wP')?.setAttribute('r', surfaceR(cfg.vp, t, depth).toFixed(1));
    $('#wS')?.setAttribute('r', surfaceR(cfg.vs, t, depth).toFixed(1));
  } else if (!ev.cancel) {
    ['cd-p', 'cd-s'].forEach((id) => { $(`#${id}`).textContent = '--'; $(`#${id}-u`).textContent = ''; });
  }
  if (!ev.cancel && (ev.warn ? now - lastBeepAt > 4000 && tS > 0 : lastBeepAt === 0)) { lastBeepAt = now; beep(ev.warn); }
}
function hide() {
  const root = $('#eew');
  if (!root.hidden) { root.hidden = true; document.body.classList.remove('eew-on'); }
  shownKey = ''; curEv = null;
}
function tick() {
  if (!cfg) return;
  const now = Date.now();
  for (const [id, ev] of events) if (now > endMsOf(ev)) { events.delete(id); dismissed.delete(id); }
  const list = [...events.values()].filter((e) => dismissed.get(e.id) !== e.serial);
  if (!list.length) { hide(); return; }
  list.sort((a, b) => (b.warn - a.warn) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
  render(list[0], now, list.length - 1);
  // 受信が途絶えた接続は張り直す
  if (conn.wolfx && now - (lastMsg.wolfx || 0) > 300000) { try { socks.wolfx.close(); } catch { /* noop */ } }
}

/* ---------- 公開関数 ---------- */
export function startEEW(c) {
  cfg = { vp: 7.0, vs: 4.0, homeAreas: [], sources: { wolfx: true, p2p: true }, sound: () => true, ...c };
  $('#eew-close').addEventListener('click', () => { if (curEv) { dismissed.set(curEv.id, curEv.serial); hide(); } });
  window.addEventListener('resize', () => { shownKey = ''; });
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach((t) => document.addEventListener(t, unlockAudio, { passive: true }));
  Object.keys(SRC).filter((n) => cfg.sources[n]).forEach((n) => connect(n));
  setInterval(tick, 250);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    Object.keys(SRC).filter((n) => cfg.sources[n] && !conn[n]).forEach((n) => { retry[n].n = 0; connect(n); });
  });
}
export function eewStatus() {
  if (!cfg) return { enabled: false, total: 0, connected: 0 };
  const names = Object.keys(SRC).filter((n) => cfg.sources[n]);
  return { enabled: true, total: names.length, connected: names.filter((n) => conn[n]).length };
}
export function simulateEEW(kind = 'warn') {
  if (!cfg) return;
  const now = Date.now(), warn = kind === 'warn';
  upsert(warn
    ? { id: 'TEST' + now, serial: 1, src: 'test', warn: true, cancel: false, training: false, assumption: false, sea: true, final: false, originMs: now - 1500, announcedMs: now,
        lat: 35.3, lon: 141.6, depth: 40, mag: 6.4, maxInt: '5強', place: '千葉県東方沖（テスト）', areas: [{ name: '東京都', from: '4', to: '5弱' }] }
    : { id: 'TEST' + now, serial: 1, src: 'test', warn: false, cancel: false, training: false, assumption: false, sea: false, final: false, originMs: now - 1500, announcedMs: now,
        lat: 36.1, lon: 140.0, depth: 50, mag: 4.8, maxInt: '3', place: '茨城県南部（テスト）', areas: [{ name: '東京都', from: '2', to: '3' }] });
  unlockAudio();
}
