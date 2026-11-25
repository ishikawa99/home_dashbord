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
