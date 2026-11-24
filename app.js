// ホームダッシュボード app.js  — 外部サービスへ直接アクセスする静的PWA（自宅サーバ不要）
const C = window.DASHBOARD_CONFIG;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 端末内ストレージ ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('hd.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hd.' + k, JSON.stringify(v)); } catch { /* 容量超過等は無視 */ } },
  del(k) { try { localStorage.removeItem('hd.' + k); } catch { /* noop */ } }
};

/* ---------- JST ヘルパー ---------- */
const fmtJ = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
});
function jst(d = new Date()) {
  const p = {};
  fmtJ.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  const h = p.hour === '24' ? '00' : p.hour;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +h, mi: +p.minute, wd: p.weekday, iso: `${p.year}-${p.month}-${p.day}`, hm: `${h}:${p.minute}` };
}
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)); };
const isoOf = (u) => u.toISOString().slice(0, 10);
const WD = ['日', '月', '火', '水', '木', '金', '土'];

/* ---------- 取得状態 ---------- */
const src = {
  weather: { label: '天気', at: 0, err: null, staleMin: C.weather.staleMin },
  calendar: { label: '予定', at: 0, err: null, staleMin: C.calendar.staleMin, demo: !C.calendar.googleClientId },
  quake: { label: '地震', at: 0, err: null, staleMin: C.quake.staleMin },
  shop: { label: '買い物', at: 0, err: null, staleMin: 1e9, off: C.shopping.mode === 'link', demo: C.shopping.mode === 'local' }
};
for (const k of ['weather', 'calendar', 'quake', 'shop']) {
  const c = store.get('cache.' + k, null);
  if (c?.at) src[k].at = c.at;
}
let online = navigator.onLine;
let wakeOn = false;

async function fetchJSON(url, opt = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

// 各データソースは独立して更新（1つが失敗しても他に影響しない）
async function refresh(name, fetcher, onData) {
  try {
    const data = await fetcher();
    store.set('cache.' + name, { at: Date.now(), data });
    src[name].at = Date.now();
    src[name].err = null;
    onData(data);
  } catch (e) {
    src[name].err = e.message || String(e);
  }
  renderStatus();
}
function every(min, fn) { fn(); return setInterval(fn, min * 60000); }

/* ---------- 時計 ---------- */
let lastDayIso = '', lastHour = -1;
function tick() {
  const t = jst();
  $('#time').textContent = t.hm;
  $('#date').textContent = `${t.y}年${t.mo}月${t.d}日 ${t.wd}曜日`;
  applyNight(t);
  if (t.iso !== lastDayIso) { lastDayIso = t.iso; renderSchedule(); }
  if (t.h !== lastHour) { lastHour = t.h; renderWeather(); }
  renderQuake();
  renderStatus();
  // 毎日4時に再読み込み（長期稼働のメモリ解放＋アプリ更新の適用）
  if (t.h === 4 && t.mi === 0 && !sessionStorage.getItem('hd.reloaded.' + t.iso)) {
    sessionStorage.setItem('hd.reloaded.' + t.iso, '1');
    location.reload();
  }
}

/* ---------- 夜間モード ---------- */
const settings = () => ({ mode: 'auto', start: C.night.start, end: C.night.end, ...store.get('settings', {}) });
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
function applyNight(t = jst()) {
  const s = settings();
  const now = t.h * 60 + t.mi, a = toMin(s.start), b = toMin(s.end);
  let night = s.mode === 'on' ? true : s.mode === 'off' ? false : (a > b ? now >= a || now < b : now >= a && now < b);
  if (phone) night = false;
  document.body.classList.toggle('night', night);
  document.querySelector('meta[name=theme-color]').content = night ? '#07080b' : '#efeae0';
}

/* ---------- 天気（Open-Meteo） ---------- */
const WMO = (c) => {
  if (c === 0) return ['☀️', '快晴'];
  if (c === 1) return ['🌤️', '晴れ'];
  if (c === 2) return ['⛅', '一部曇り'];
  if (c === 3) return ['☁️', '曇り'];
  if (c === 45 || c === 48) return ['🌫️', '霧'];
  if (c >= 51 && c <= 57) return ['🌦️', '霧雨'];
  if (c >= 61 && c <= 67) return ['🌧️', c >= 65 ? '強い雨' : c === 63 ? '雨' : '弱い雨'];
  if (c >= 71 && c <= 77) return ['🌨️', '雪'];
  if (c >= 80 && c <= 82) return ['🌦️', 'にわか雨'];
  if (c === 85 || c === 86) return ['🌨️', 'にわか雪'];
  if (c >= 95) return ['⛈️', '雷雨'];
  return ['❔', '--'];
};
let weatherData = store.get('cache.weather', null)?.data ?? null;
function fetchWeather() {
  const { lat, lon } = C.location;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code' +
    '&hourly=temperature_2m,precipitation_probability,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=Asia%2FTokyo&forecast_days=2';
  return fetchJSON(u);
}
function renderWeather() {
  $('#w-place').textContent = C.location.name;
  const d = weatherData;
  if (!d) return;
  const t = jst();
  const [icon, desc] = WMO(d.current.weather_code);
  let idx = d.hourly.time.findIndex((x) => x >= `${t.iso}T${String(t.h).padStart(2, '0')}:00`);
  if (idx < 0) idx = 0;
  const hours = [];
  for (let i = idx; i < idx + 12 && i < d.hourly.time.length; i++) {
    const [hi] = WMO(d.hourly.weather_code[i]);
    hours.push(`<div class="wh"><div class="t">${+d.hourly.time[i].slice(11, 13)}時</div><div class="i">${hi}</div>` +
      `<div>${Math.round(d.hourly.temperature_2m[i])}°</div><div class="p">${d.hourly.precipitation_probability[i] ?? '-'}%</div></div>`);
  }
  const di = Math.max(0, d.daily.time.indexOf(t.iso));
  $('#w-body').innerHTML =
    `<div id="w-now"><div id="w-icon">${icon}</div>` +
    `<div><div id="w-temp">${Math.round(d.current.temperature_2m)}°</div><div id="w-desc">${esc(desc)}</div></div>` +
    `<div id="w-hilo"><div><span class="hi">最高 ${Math.round(d.daily.temperature_2m_max[di])}°</span> / <span class="lo">最低 ${Math.round(d.daily.temperature_2m_min[di])}°</span></div>` +
    `<div>降水確率 ${d.daily.precipitation_probability_max[di] ?? '-'}%</div></div></div>` +
    `<div id="w-hours">${hours.join('')}</div>`;
}

/* ---------- スケジュール（Google Calendar） ---------- */
let events = store.get('cache.calendar', null)?.data ?? null;   // 正規化済みイベント配列
const legendHTML = () => C.calendar.calendars.map((c) => `<span><i style="--c:${c.color}"></i>${esc(c.name)}</span>`).join('');

function daysCovered(startISO, endISO) {
  const out = [];
  for (let u = new Date(startISO + 'T00:00:00Z'); isoOf(u) <= endISO && out.length < 14; u = new Date(u.getTime() + 864e5)) out.push(isoOf(u));
  return out;
}
function normalizeEvent(e, cal) {
  const allDay = !!e.start.date;
  let days, startHM = '', endHM = '', sort;
  if (allDay) {
    const endEx = isoOf(new Date(new Date(e.end.date + 'T00:00:00Z').getTime() - 864e5));
    days = daysCovered(e.start.date, endEx < e.start.date ? e.start.date : endEx);
    sort = -1;
  } else {
    const s = new Date(e.start.dateTime), en = new Date(e.end?.dateTime || e.start.dateTime);
    startHM = jst(s).hm; endHM = jst(en).hm;
    days = daysCovered(jst(s).iso, jst(new Date(Math.max(s, en - 1))).iso);
    sort = s.getTime();
  }
  return { title: e.summary || '(無題)', allDay, startHM, endHM, days, sort, color: cal.color, who: cal.name };
}
function demoEvents() {
  const t = jst().iso, d = (n) => isoOf(addDays(t, n));
  const mk = (n, title, s, e, i, allDay) => ({ title, allDay: !!allDay, startHM: s || '', endHM: e || '', days: [d(n)], sort: allDay ? -1 : toMin(s) + n * 1440, color: C.calendar.calendars[i].color, who: C.calendar.calendars[i].name });
  return [
    mk(0, '朝のゴミ出し', '07:30', '07:45', 2), mk(0, '歯医者', '15:00', '16:00', 0), mk(0, '夕食 外食', '19:00', '21:00', 2),
    mk(1, '会議', '10:00', '11:30', 1), mk(2, 'ヨガ', '19:30', '20:30', 0), mk(3, '記念日', '', '', 2, true),
    mk(4, '飲み会', '19:00', '22:00', 1), mk(5, '映画', '13:00', '15:30', 2), mk(5, '美容院', '17:00', '18:30', 0)
  ];
}

/* Google 認証（Google Identity Services・トークンモデル。クライアントIDは公開前提でシークレット不要） */
const GSCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
let gToken = store.get('gtoken', null), tokenClient = null, needAuth = false;
function loadGIS() {
  return new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Google認証ライブラリを読み込めません'));
    document.head.appendChild(s);
  });
}
async function getToken(interactive) {
  if (gToken && gToken.exp > Date.now() + 60000) return gToken.value;
  // 一度もログインしていない端末では、ポップアップ制限に引っかかるので自動試行せずボタンを出す
  if (!interactive && (needAuth || !store.get('authed', false))) throw new Error('要ログイン');
  await loadGIS();
  return new Promise((resolve, reject) => {
    if (!interactive) setTimeout(() => reject(new Error('要ログイン')), 8000);
    tokenClient ||= google.accounts.oauth2.initTokenClient({ client_id: C.calendar.googleClientId, scope: GSCOPE, callback: () => {}, error_callback: () => {} });
    tokenClient.callback = (r) => {
      if (r.error) return reject(new Error(r.error));
      gToken = { value: r.access_token, exp: Date.now() + r.expires_in * 1000 };
      store.set('gtoken', gToken); store.set('authed', true); needAuth = false; resolve(gToken.value);
    };
    tokenClient.error_callback = (e) => reject(new Error(e?.type || 'auth'));
    tokenClient.requestAccessToken({ prompt: '' });
  });
}
async function fetchCalendar() {
  src.calendar.partial = null;
  if (src.calendar.demo) return demoEvents();
  let token;
  try { token = await getToken(false); } catch (e) { needAuth = true; $('#cal-login').hidden = false; throw new Error('要ログイン'); }
  const t = jst().iso;
  const q = new URLSearchParams({ timeMin: `${t}T00:00:00+09:00`, timeMax: `${isoOf(addDays(t, 7))}T00:00:00+09:00`, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
  const all = [];
  const results = await Promise.allSettled(C.calendar.calendars.map(async (cal) => {
    const j = await fetchJSON(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${q}`, { headers: { Authorization: 'Bearer ' + token } });
    return (j.items || []).filter((e) => e.status !== 'cancelled' && e.start).map((e) => normalizeEvent(e, cal));
  }));
  const bad = results.filter((r) => r.status === 'rejected');
  if (bad.some((r) => r.reason?.status === 401)) { gToken = null; store.del('gtoken'); needAuth = true; $('#cal-login').hidden = false; throw new Error('要ログイン'); }
  results.forEach((r) => r.status === 'fulfilled' && all.push(...r.value));
  if (bad.length === results.length) throw bad[0].reason;
  if (bad.length) src.calendar.partial = `${bad.length}件のカレンダーを取得できません`;
  $('#cal-login').hidden = true;
  return all;
}
function renderSchedule() {
  $('#legend').innerHTML = legendHTML();
  const t = jst().iso;
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const u = addDays(t, i), iso = isoOf(u), wd = u.getUTCDay();
    const list = (events || []).filter((e) => e.days.includes(iso)).sort((a, b) => a.sort - b.sort);
    const MAX = 5;
    const chips = list.slice(0, MAX).map((e) => {
      const time = e.allDay ? '終日' : `${e.startHM}–${e.endHM}`;
      return `<span class="ev" style="--c:${e.color}"><b>${time}</b>${esc(e.title)}<em>${esc(e.who)}</em></span>`;
    }).join('');
    const more = list.length > MAX ? `<span class="more">他${list.length - MAX}件</span>` : '';
    rows.push(`<div class="day ${i === 0 ? 'today' : ''} ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">` +
      `<div class="dlabel"><b>${u.getUTCDate()}</b>${WD[wd]}</div>` +
      `<div class="evs">${chips || '<span class="none">予定なし</span>'}${more}</div></div>`);
  }
  $('#days').innerHTML = rows.join('');
}

/* ---------- 地震情報（気象庁 bosai JSON） ---------- */
const INT_ORDER = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'];
const INT_LABEL = { '1': '1', '2': '2', '3': '3', '4': '4', '5-': '5弱', '5+': '5強', '6-': '6弱', '6+': '6強', '7': '7' };
const intRank = (m) => INT_ORDER.indexOf(m);
const intClass = (m) => (m === '5-' ? 'i5m' : m === '5+' ? 'i5p' : m === '6-' ? 'i6m' : m === '6+' ? 'i6p' : 'i' + m);
let quakeData = store.get('cache.quake', null)?.data ?? null;
const JMA = 'https://www.jma.go.jp/bosai/quake/data/';

async function fetchQuake() {
  const list = await fetchJSON(JMA + 'list.json?_=' + Math.floor(Date.now() / 60000));
  const seen = new Set(), items = [];
  for (const e of list) {
    if (!e.eid || seen.has(e.eid) || e.ttl === '顕著な地震の震源要素更新のお知らせ') continue;
    seen.add(e.eid);
    const m = /^([+-][\d.]+)([+-][\d.]+)([+-]\d+)?/.exec(e.cod || '');
    items.push({ id: e.eid, at: e.at, rdt: e.rdt, area: e.anm || '', mag: e.mag || '', maxi: e.maxi || '', depth: m && m[3] ? Math.abs(+m[3]) / 1000 : null, json: e.json });
    if (items.length >= 4) break;
  }
  let detail = null;
  if (items[0]?.json) {
    try {
      const j = await fetchJSON(JMA + items[0].json);
      const prefs = j.Body?.Intensity?.Observation?.Pref || [];
      const p = prefs.find((x) => x.Name === C.quake.area);
      const text = [j.Body?.Comments?.ForecastComment?.Text, j.Body?.Comments?.FreeFormComment].filter(Boolean).join(' ');
      detail = { id: items[0].id, areaInt: p?.MaxInt || '', tsunami: /津波/.test(text) ? text.trim() : '' };
    } catch { /* 詳細が取れなくても一覧は表示 */ }
  }
  return { items, detail };
}
function quakeAlertActive(it) {
  if (!it) return false;
  const within = Date.now() - new Date(it.rdt || it.at).getTime() < C.quake.alertMinutes * 60000;
  return within && intRank(it.maxi) >= intRank(C.quake.alertMinIntensity) && intRank(it.maxi) >= 0;
}
function renderQuake() {
  const d = quakeData, box = $('#q-body');
  if (!d || !d.items.length) { if (d) box.innerHTML = '<div class="empty">直近の地震情報はありません</div>'; return; }
  const [q, ...rest] = d.items;
  const alert = quakeAlertActive(q);
  $('#quake').classList.toggle('alert', alert);
  const ban = $('#quake-banner');
  if (alert) {
    ban.hidden = false;
    ban.textContent = `地震情報：${q.area || '震源調査中'} 最大震度${INT_LABEL[q.maxi] || '-'}　M${q.mag || '-'}（${jst(new Date(q.at)).hm} 発生）`;
  } else ban.hidden = true;
  const hm = (s) => { const j = jst(new Date(s)); return `${j.mo}/${j.d} ${j.hm}`; };
  const det = d.detail && d.detail.id === q.id ? d.detail : null;
  const areaLine = det ? `<div class="q-area">${esc(C.quake.area)}：${det.areaInt ? '震度' + (INT_LABEL[det.areaInt] || det.areaInt) : '震度観測なし'}</div>` : '';
  box.innerHTML =
    `<div class="q-main"><div class="q-int ${intClass(q.maxi)}"><small>最大震度</small><b>${INT_LABEL[q.maxi] || '-'}</b></div>` +
    `<div class="q-info"><div class="place">${esc(q.area || '震源調査中')}</div>` +
    `<div>M${esc(q.mag || '-')} ／ 深さ ${q.depth == null ? '-' : (q.depth === 0 ? 'ごく浅い' : Math.round(q.depth) + 'km')}</div></div></div>` +
    `<div class="q-sub">発生 ${hm(q.at)} ／ 発表 ${hm(q.rdt || q.at)}</div>` + areaLine +
    (det?.tsunami ? `<div class="q-tsu">🌊 津波：${esc(det.tsunami.slice(0, 60))}</div>` : '') +
    `<div class="q-list">${rest.slice(0, 2).map((r) => `<div><span>${hm(r.at)}</span><span>${esc(r.area || '調査中')}</span><span>震度${INT_LABEL[r.maxi] || '-'}</span><span>M${esc(r.mag || '-')}</span></div>`).join('')}</div>`;
}

/* ---------- 買い物リスト ---------- */
const shopCfg = C.shopping;
let shopItems = store.get(shopCfg.mode === 'local' ? 'shop.local' : 'cache.shop', null);
if (shopCfg.mode !== 'local') shopItems = shopItems?.data ?? [];
else shopItems = shopItems ?? [];
let shopBackend = null, shopNeedAuth = null;
const uid = () => Math.random().toString(36).slice(2, 10);

function renderShop() {
  const el = $('#shop-extra');
  if (shopCfg.mode === 'link') {
    $('#shop-count').textContent = '';
    $('#shop-list').innerHTML = '';
    el.innerHTML = `<a class="btn primary" href="${esc(shopCfg.linkUrl)}" target="_blank" rel="noopener">${esc(shopCfg.linkLabel)}</a>`;
    return;
  }
  el.innerHTML = shopNeedAuth ? '<button class="btn primary" id="shop-login">Googleでログイン</button>' : '';
  $('#shop-login')?.addEventListener('click', () => shopNeedAuth());
  const open = shopItems.filter((i) => !i.done), done = shopItems.filter((i) => i.done);
  $('#shop-count').textContent = `未購入 ${open.length}`;
  $('#shop-list').innerHTML = [...open, ...done].map((i) =>
    `<li class="${i.done ? 'done' : ''}" data-id="${esc(i.id)}"><span class="ck">${i.done ? '✓' : ''}</span>` +
    `<span class="nm">${esc(i.name)}</span>${i.by ? `<span class="by">${esc(i.by)}</span>` : ''}<button class="rm" aria-label="削除">✕</button></li>`).join('') ||
    '<li class="none"><span class="nm">買うものはありません</span></li>';
}
function localBackend() {
  const save = () => { store.set('shop.local', shopItems); src.shop.at = Date.now(); src.shop.err = null; renderShop(); renderStatus(); };
  return {
    add: async (name) => { shopItems.push({ id: uid(), name, done: false, by: '', at: Date.now() }); save(); },
    toggle: async (it) => { it.done = !it.done; save(); },
    remove: async (it) => { shopItems = shopItems.filter((x) => x !== it); save(); }
  };
}
async function startFirebase() {
  try {
    const B = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const [{ initializeApp }, fs, au] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-firestore.js'), import(B + 'firebase-auth.js')]);
    const app = initializeApp(shopCfg.firebase), db = fs.getFirestore(app), auth = au.getAuth(app), col = fs.collection(db, 'shopping');
    shopBackend = {
      add: (name) => fs.addDoc(col, { name, done: false, by: auth.currentUser?.displayName?.split(' ')[0] || '', at: Date.now() }),
      toggle: (it) => fs.updateDoc(fs.doc(db, 'shopping', it.id), { done: !it.done }),
      remove: (it) => fs.deleteDoc(fs.doc(db, 'shopping', it.id))
    };
    let unsub = null;
    au.onAuthStateChanged(auth, (user) => {
      unsub?.();
      if (!user) { shopNeedAuth = () => au.signInWithPopup(auth, new au.GoogleAuthProvider()).catch((e) => { src.shop.err = e.code; renderStatus(); }); renderShop(); return; }
      shopNeedAuth = null;
      unsub = fs.onSnapshot(fs.query(col, fs.orderBy('at', 'asc')), (snap) => {
        shopItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        store.set('cache.shop', { at: Date.now(), data: shopItems });
        src.shop.at = Date.now(); src.shop.err = null; renderShop(); renderStatus();
      }, (err) => { src.shop.err = err.code || err.message; renderStatus(); });
    });
  } catch (e) { src.shop.err = e.message; renderStatus(); }
}
function initShop() {
  if (shopCfg.mode === 'local') { shopBackend = localBackend(); src.shop.at = src.shop.at || Date.now(); }
  if (shopCfg.mode === 'firebase') startFirebase();
  renderShop();
  $('#shop-list').addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-id]'); if (!li || !shopBackend) return;
    const it = shopItems.find((x) => x.id === li.dataset.id); if (!it) return;
    (ev.target.closest('.rm') ? shopBackend.remove(it) : shopBackend.toggle(it)).catch((e) => { src.shop.err = e.message; renderStatus(); });
  });
  $('#shop-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = $('#shop-input').value.trim(); if (!v || !shopBackend) return;
    $('#shop-input').value = '';
    shopBackend.add(v).catch((e) => { src.shop.err = e.message; renderStatus(); });
  });
}

/* ---------- 更新状態バー ---------- */
function renderStatus() {
  const now = Date.now(), parts = [];
  for (const [k, s] of Object.entries(src)) {
    const tag = $('#tag-' + k);
    if (s.off) { if (tag) { tag.textContent = ''; tag.className = 'tag'; } continue; }
    const t = s.at ? jst(new Date(s.at)).hm : '--:--';
    const old = s.at && now - s.at > s.staleMin * 60000;
    let cls = 'ok', txt = t, tagTxt = '', tagCls = '';
    if (s.err && !s.at) { cls = 'err'; txt = `取得失敗(${s.err})`; tagTxt = '取得失敗'; tagCls = 'err'; }
    else if (s.err) { cls = 'warn'; txt = `取得失敗 ${t}時点`; tagTxt = `取得失敗・${t}時点の情報`; tagCls = 'warn'; }
    else if (!s.at) { cls = 'warn'; txt = '未取得'; }
    else if (old) { cls = 'warn'; txt = `${t} 古い情報`; tagTxt = `古い情報（${t}）`; tagCls = 'warn'; }
    else if (s.partial && k === 'calendar') { cls = 'warn'; txt += ` ${s.partial}`; tagTxt = s.partial; tagCls = 'warn'; }
    if (s.demo) { tagTxt = 'デモ表示'; tagCls = 'demo'; txt += '(デモ)'; }
    parts.push(`<span class="st ${cls}">${s.label} ${esc(txt)}</span>`);
    if (tag) { tag.textContent = tagTxt; tag.className = 'tag ' + tagCls; }
  }
  $('#status').innerHTML =
    `<span class="st ${online ? 'ok' : 'err'}">${online ? '● オンライン' : '✕ オフライン（最終取得分を表示中）'}</span>` + parts.join('') +
    (wakeOn ? '<span class="st">🔆 画面ON維持</span>' : '') + '<span class="sp"></span><button id="open-set" aria-label="設定">⚙︎</button>';
  $('#open-set').onclick = openSettings;
}

/* ---------- 設定ダイアログ ---------- */
function openSettings() {
  const s = settings();
  $('#set-mode').value = s.mode; $('#set-start').value = s.start; $('#set-end').value = s.end;
  $('#settings').showModal();
}
$('#settings').addEventListener('close', () => {
  if ($('#settings').returnValue !== 'save') return;
  store.set('settings', { mode: $('#set-mode').value, start: $('#set-start').value || C.night.start, end: $('#set-end').value || C.night.end });
  applyNight();
});

/* ---------- 画面スリープ抑止 ---------- */
let wl = null;
async function lockScreen() {
  try {
    if (!('wakeLock' in navigator) || phone) return;
    wl = await navigator.wakeLock.request('screen');
    wakeOn = true; wl.addEventListener('release', () => { wakeOn = false; renderStatus(); });
    renderStatus();
  } catch { wakeOn = false; }
}

/* ---------- 起動 ---------- */
const phoneMQ = matchMedia('(max-width:700px)');
let phone = phoneMQ.matches || /[?&]phone\b/.test(location.search);
const setPhone = () => { phone = phoneMQ.matches || /[?&]phone\b/.test(location.search); document.body.classList.toggle('phone', phone); applyNight(); };
phoneMQ.addEventListener?.('change', setPhone);
setPhone();

initShop();
renderWeather(); renderSchedule(); renderQuake(); renderStatus();
tick(); setInterval(tick, 20000);

const timers = () => {
  every(C.weather.refreshMin, () => refresh('weather', fetchWeather, (d) => { weatherData = d; renderWeather(); }));
  every(C.calendar.refreshMin, () => refresh('calendar', fetchCalendar, (d) => { events = d; src.calendar.partial = src.calendar.partial; renderSchedule(); }));
  every(C.quake.refreshMin, () => refresh('quake', fetchQuake, (d) => { quakeData = d; renderQuake(); }));
};
timers();

$('#cal-login').addEventListener('click', async () => {
  try { await getToken(true); needAuth = false; $('#cal-login').hidden = true; refresh('calendar', fetchCalendar, (d) => { events = d; renderSchedule(); }); }
  catch (e) { src.calendar.err = e.message; renderStatus(); }
});

// 通信状態・復帰時の再取得
const refreshAll = () => {
  refresh('weather', fetchWeather, (d) => { weatherData = d; renderWeather(); });
  refresh('calendar', fetchCalendar, (d) => { events = d; renderSchedule(); });
  refresh('quake', fetchQuake, (d) => { quakeData = d; renderQuake(); });
};
window.addEventListener('online', () => { online = true; renderStatus(); refreshAll(); });
window.addEventListener('offline', () => { online = false; renderStatus(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { lockScreen(); tick(); refreshAll(); } });
lockScreen();
document.addEventListener('click', () => { if (!wl) lockScreen(); }, { passive: true });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
