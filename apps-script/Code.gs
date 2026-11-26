/**
 * ホームダッシュボード用：Googleカレンダーの予定を Firebase(Firestore) へ書き出す
 *
 * 5分おきに自動実行します。iPadはFirestoreを読むだけなので、Googleの再ログインが不要になります。
 * 手順は README.md の「6. 予定の取得を再ログイン不要にする」を参照してください。
 */
const FIREBASE_PROJECT_ID = 'homedashboard-3cdf9';   // Firebaseのプロジェクトid
const DAYS = 8;                                       // 今日から何日分を書き出すか
const TZ = 'Asia/Tokyo';
// config.js の calendar.calendars と同じ内容にしてください（name・color は画面の色分けに使われます）
const CALENDARS = [
  { id: 'primary', name: '達也', color: '#3b82f6' },
  { id: 'ttisland.love215@gmail.com', name: '優', color: '#ec4899' },
  { id: '3fb27e96889c44b11791ef2229823ee8a57dd1c3e352538e3def5937b9134531@group.calendar.google.com', name: '共有', color: '#f59e0b' }
];

/** 最初に1回だけ実行：5分おきの自動実行を設定します */
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncCalendar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncCalendar').timeBased().everyMinutes(5).create();
}

/** 予定を取得して Firestore の dashboard/calendar に書き込みます（自動実行される本体） */
function syncCalendar() {
  const todayISO = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const start = new Date(todayISO + 'T00:00:00+09:00');
  const end = new Date(start.getTime() + DAYS * 864e5);
  const events = [];
  const failed = [];
  CALENDARS.forEach((c) => {
    try {
      const cal = c.id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(c.id);
      if (!cal) throw new Error('カレンダーが見つかりません');
      cal.getEvents(start, end).forEach((e) => {
        if (e.getMyStatus() === CalendarApp.GuestStatus.NO) return;   // 辞退した予定は表示しない
        events.push(toEvent(e, c));
      });
    } catch (err) {
      failed.push(c.name + ': ' + err.message);
    }
  });
  if (failed.length === CALENDARS.length) throw new Error(failed.join(' / '));
  writeFirestore(JSON.stringify(events), failed.join(' / '));
}

function ymd(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function hm(d) { return Utilities.formatDate(d, TZ, 'HH:mm'); }
function daysBetween(a, b) {
  const out = [];
  let t = new Date(a + 'T00:00:00Z').getTime();
  const last = new Date(b + 'T00:00:00Z').getTime();
  while (t <= last && out.length < 14) { out.push(new Date(t).toISOString().slice(0, 10)); t += 864e5; }
  return out;
}

/** ダッシュボードが読む形式（app.js の予定データ）に変換します */
function toEvent(e, c) {
  let days, startHM = '', endHM = '', sort;
  if (e.isAllDayEvent()) {
    const s = ymd(e.getAllDayStartDate());
    const lastDay = ymd(new Date(e.getAllDayEndDate().getTime() - 864e5));   // 終了日は含まれないので1日戻す
    days = daysBetween(s, lastDay < s ? s : lastDay);
    sort = -1;
  } else {
    const st = e.getStartTime();
    const en = e.getEndTime();
    startHM = hm(st);
    endHM = hm(en);
    days = daysBetween(ymd(st), ymd(new Date(Math.max(st.getTime(), en.getTime() - 1))));
    sort = st.getTime();
  }
  return { title: e.getTitle() || '(無題)', allDay: e.isAllDayEvent(), startHM: startHM, endHM: endHM, days: days, sort: sort, color: c.color, who: c.name };
}

function writeFirestore(json, partial) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/dashboard/calendar';
  const body = {
    fields: {
      json: { stringValue: json },
      updatedAt: { integerValue: String(Date.now()) },
      partial: { stringValue: partial || '' }
    }
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Firestoreへの書き込みに失敗 (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
}
