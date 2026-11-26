# ホームダッシュボード（PWA）

自宅サーバ不要。静的ホスティング（GitHub Pages / Cloudflare Pages）に置くだけで動きます。
そのまま開くと **デモ表示（予定はサンプル、買い物は端末内のみ）** で動作確認できます。

## 1. 公開
1. このフォルダ一式をGitHubリポジトリに置き、Settings → Pages で公開（またはCloudflare Pagesにアップロード）。
2. iPad（Safari）で公開URLを開き、共有 → 「ホーム画面に追加」。
3. iPadの設定 → 画面表示と明るさ → 自動ロック →「なし」。充電器に常時接続。
4. スマホでも同URLを開いてホーム画面に追加（狭い画面では自動で操作用レイアウトになります。`?phone` を付けると強制）。

## 2. 設定（config.js）
- 天気の地域: `location`（初期値：東京都大田区）
- 夜間: 既定 22:00〜07:00。画面右下の ⚙︎ から変更可。
- 地震の対象地域: `quake.area`、強調表示の閾値: `quake.alertMinIntensity`

## 3. Googleカレンダー連携（非公開のまま取得）
1. Google Cloud Console でプロジェクト作成 → 「Google Calendar API」を有効化。
2. OAuth同意画面（外部・テスト中でOK）→ テストユーザーに二人のGoogleアカウントを追加。
3. 認証情報 → OAuthクライアントID（ウェブアプリ）。「承認済みのJavaScript生成元」に公開URLのオリジン（例 `https://xxx.github.io`）を登録。
4. `config.js` の `googleClientId` にクライアントIDを入力。`calendars` に表示したいカレンダーID（本人・相手・共有）を設定。
5. 相手のカレンダーは「共有」設定で、ログインするアカウントに閲覧権限を付与。
6. iPadでアプリを開き、予定欄の「Googleにログイン」をタップ。

※クライアントIDは公開前提の識別子で、シークレットは使いません。アクセストークンは約1時間で失効し、自動再取得を試みます。iPadのPWAでサイレント更新が通らない場合は「要ログイン」と表示されるので再タップしてください（要件9-3の検証ポイント）。

## 4. 買い物リスト（`shopping.mode`）
- `link`: 既存アプリ（Googleキープ等）へのリンクを表示。
- `firebase`: 二人共有の自前リスト（下記）。
- `local`: 端末内のみ（動作確認用、共有不可）。

### Firebase の設定（無料枠で足ります）
1. [Firebaseコンソール](https://console.firebase.google.com/)でプロジェクト作成（Google Analyticsは不要）。
2. Build → Firestore Database → データベースを作成（本番モード、ロケーションは asia-northeast1 など）。
3. Build → Authentication → 始める → ログイン方法で **Google** を有効化。
4. Authentication → 設定 → 承認済みドメインに公開ドメイン（例 `yourname.github.io`）を追加。
5. プロジェクトの設定 → マイアプリ → Webアプリ(</>)を追加し、表示される `firebaseConfig` を `config.js` の `shopping.firebase` に貼る。
6. Firestore → ルール に下記を貼って公開（メールアドレスは二人のもの）。
```
rules_version = '2';
service cloud.firestore { match /databases/{db}/documents {
  match /shopping/{id} {
    allow read, write: if request.auth != null
      && request.auth.token.email_verified == true
      && request.auth.token.email in ['aさん@gmail.com','bさん@gmail.com'];
  }
}}
```
7. `config.js`: `mode: 'firebase'`、`userNames` に二人のメールと表示名を記入。
8. 各端末（iPad・スマホ）で買い物欄の「Googleでログイン」を一度だけタップ。ログインは端末内に保持されます。

`apiKey` 等はFirebaseの公開前提の識別子で、守っているのはルールです。ルールを必ず設定してください。

## 5. 既知の制約・要検証事項
- 地震情報は気象庁 bosai の `list.json` を直接取得します。**CORS可否は実機で要確認**（失敗時は画面に「取得失敗」と表示され、他機能は継続）。参考表示であり、緊急地震速報の代替ではありません。
- 画面常時表示は Wake Lock API（iOS 16.4+）を使用。効かない場合は自動ロック「なし」が必須。
- 夜間の輝度は画面内の配色・減光のみ（端末の物理輝度は制御不可）。
- 毎日4:00に自動で再読み込みします（長期稼働対策）。
- 外部APIの利用規約・無料枠は各サービスで確認してください（Open-Meteoは非商用無料）。

## 6. 予定の取得を再ログイン不要にする（Apps Script中継）
ブラウザで直接Googleにログインする方式（`source: 'google'`）では、アクセス権が約1時間で切れ、iPadのホーム画面アプリでは自動で更新できないため、1日に何度も再ログインが必要になります。
そこで、Googleのサーバー上で動くApps Scriptが5分おきに予定を読み、Firebaseへ書き込みます。iPadはFirebaseを読むだけなので、Googleの再ログインが不要です（Firebaseのログインは買い物リストと共通で、切れません）。自宅サーバは不要です。

### 手順（達也さんのGoogleアカウントで操作）
1. **Firestore APIを有効化**：[Cloud Firestore API](https://console.cloud.google.com/apis/library/firestore.googleapis.com?project=500673253020) を開き、「有効にする」（Googleカレンダー用に作ったプロジェクトです）。
2. [Apps Script](https://script.google.com/) →「新しいプロジェクト」。名前は「ダッシュボード予定同期」など。
3. 左の「プロジェクトの設定」→「"appsscript.json" マニフェスト ファイルをエディタで表示する」をオン。エディタに戻り、`appsscript.json` の中身を、このzipの `apps-script/appsscript.json` に置き換えます。
4. `コード.gs`（Code.gs）の中身を、`apps-script/Code.gs` に置き換えて保存。`CALENDARS` が `config.js` と同じか確認します。
5. 「プロジェクトの設定」→「Google Cloud Platform（GCP）プロジェクト」→「プロジェクトを変更」→ プロジェクト番号 **500673253020** を入力して「プロジェクトを設定」。
6. エディタで関数 `syncCalendar` を選び「実行」。権限の確認画面が出たら、「詳細」→「（プロジェクト名）に移動」→ すべて許可します。成功すると、Firebaseコンソール → Firestore に `dashboard` → `calendar` が作られます。
7. 関数 `setupTrigger` を選んで「実行」（5分おきの自動実行を設定します）。
8. **Firestoreのルールに追記**します（`shopping` のルールの下に追加）。
```
  match /dashboard/{id} {
    allow read: if request.auth != null
      && request.auth.token.email_verified == true
      && request.auth.token.email in ['tatsuya.0419.ishikawa@gmail.com','ttisland.love215@gmail.com'];
    allow write: if false;
  }
```
9. `config.js` の `calendar.source` を `'firestore'` に変えて、GitHubにpush。iPadを開き直します（Firebaseに未ログインの端末は、予定欄のボタンから一度だけログイン）。

### 注意
- **OAuth同意画面の公開状態を「本番環境」にしてください。** 「テスト」のままだと、約7日で自動実行の権限が切れます。
- 予定の反映は最大5分遅れます（トリガーは1分おきにもできますが、Apps Scriptの1日の実行時間の上限に近づきます）。
- 画面下の「予定 ○○:○○」は、Apps Scriptが最後に書き込んだ時刻です。止まると15分後に「古い情報」と警告が出ます。
- 権限のエラーが出る場合は、`appsscript.json` の `calendar.readonly` を `https://www.googleapis.com/auth/calendar` に変えてください。
- Apps Scriptの失敗通知は、トリガー画面（時計のアイコン）で「失敗時の通知設定」から設定できます。
- 元の方式に戻すときは、`source` を `'google'` に戻します。
