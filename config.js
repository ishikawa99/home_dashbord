/* ===== ホームダッシュボード 設定 =====
 * ここだけ編集すれば動作を切り替えられます。
 * ※ここに書く clientId / Firebase 設定は「公開前提の識別子」です。秘密鍵・APIシークレットは書かないでください。
 */
window.DASHBOARD_CONFIG = {
  // 天気の地域（初期値：東京都大田区）
  location: { name: '東京都大田区', lat: 35.5613, lon: 139.7161 },

  weather: { refreshMin: 20, staleMin: 90 },

  calendar: {
    // Google Cloud で作成した OAuth クライアントID（ウェブアプリ）。空欄の間は「デモ表示」になります。
    // 予定の取得方式。'google'=ブラウザでGoogleにログインして直接取得（約1時間ごとに再ログインが必要な場合あり）
    //              'firestore'=Apps Script がFirebaseに書き込んだ予定を読む（Googleの再ログイン不要。README参照）
    source: 'google',
    googleClientId: '500673253020-mjrcknmr4nqd8lun83p2v7iitktm4hdl.apps.googleusercontent.com',
    refreshMin: 3,
    staleMin: 15,
    // 表示するカレンダー。id は Googleカレンダー設定の「カレンダーID」。自分の既定は 'primary'
    calendars: [
      { id: 'primary', name: '達也', color: '#3b82f6' },
      { id: 'ttisland.love215@gmail.com', name: '優', color: '#ec4899' },
      { id: '3fb27e96889c44b11791ef2229823ee8a57dd1c3e352538e3def5937b9134531@group.calendar.google.com', name: '共有', color: '#f59e0b' }
    ]
  },

  quake: {
    refreshMin: 2,
    staleMin: 15,
    area: '東京都',          // 「対象地域」の震度を表示する都道府県名（気象庁の表記）
    alertMinutes: 60,         // 発表からこの時間は強調表示
    alertMinIntensity: '3'    // この震度以上で強調表示（1,2,3,4,5-,5+,6-,6+,7）
  },

  shopping: {
    // 'local'    : この端末内のみ（動作確認用・共有不可）
    // 'link'     : 既存アプリ（Googleキープ/AnyList/Bring!等）へのリンクを表示
    // 'firebase' : Firebase Firestore で二人共有（要 firebase 設定）
    mode: 'firebase',
    linkUrl: 'https://keep.google.com/',
    linkLabel: '買い物リストアプリを開く',
    // 登録者の表示名（ログインしたGoogleアカウントのメール → 表示名）
    userNames: {
      'tatsuya.0419.ishikawa@gmail.com': '達也',
      'ttisland.love215@gmail.com': '優'
    },
    firebase: {
      // Firebaseコンソール「プロジェクトの設定」→ マイアプリ → Webアプリの設定をコピー
      apiKey: 'AIzaSyBLvsVinq2uB-k7KJyU8wgAaxxlTXEDeIg',
      authDomain: 'homedashboard-3cdf9.firebaseapp.com',
      projectId: 'homedashboard-3cdf9',
      storageBucket: 'homedashboard-3cdf9.firebasestorage.app',
      messagingSenderId: '627201215252',
      appId: '1:627201215252:web:49e0156c0a28ed22e79001'
    }
  },

  // 緊急地震速報（P波・S波の到達予想を全画面で表示）。参考表示で、専用の受信機器やスマホ・テレビの速報の代わりにはなりません
  eew: {
    enabled: true,
    homeShort: '大田区',          // 地図に表示する自宅の名前
    homeAreas: ['東京都'],        // 予想震度を表示する地域名（配信元の地域名に含まれる文字）
    // home: { lat: 35.5613, lon: 139.7161 },   // 自宅の位置（省略すると天気の地域と同じ）
    vp: 7.0,                      // P波の速度（km/秒）。到達時刻の概算に使います
    vs: 4.0,                      // S波の速度（km/秒）
    sound: true,                  // 音を鳴らす（iPadは起動後に一度画面に触れる必要があります）
    sources: { wolfx: true, p2p: true }
  },

  night: { start: '22:00', end: '07:00' }
};
