# Hanabi Chat

Node.js (Express) + Socket.IO で作ったLINE風リアルタイムチャットアプリです。

## 機能
- メールアドレスでログイン／新規登録（パスワードなしの簡易認証）
- テキスト送信・画像送信・スタンプ送信（すべてリアルタイム、Socket.IOでpush配信）
- 1対1チャット／グループチャット作成
- アイコン変更（絵文字＋背景色）
- 音声通話・ビデオ通話（WebRTC、Socket.IOをシグナリングに使用）

## データの保存について
`db.json` というファイルに全データ（ユーザー・チャット・メッセージ）を保存する簡易DBです。

画像は **ブラウザ側で自動的にリサイズ・圧縮**（長辺480px・JPEG圧縮）してからアップロードされるので、
1枚あたり数十KB〜100KB程度に収まります。保存先は次のように自動で切り替わります。

- **Cloudinary の環境変数が設定されている場合** → Cloudinaryに保存（推奨・本番向け）
- **設定されていない場合** → サーバーの `uploads/` フォルダに保存（ローカル開発向け・簡易）

**注意:** Render / Railway 等の多くのホスティングはディスクが「エフェメラル」（再デプロイやスケールで消える）です。
デモや個人利用には十分ですが、本番運用するなら
- ユーザー/チャット/メッセージ → MongoDB Atlas や PostgreSQL に置き換える
- 画像 → 下記の Cloudinary 設定を使う（すでに対応済み）

ことを推奨します。

### Cloudinary の設定方法（無料・画像保存をディスクから切り離す）

1. https://cloudinary.com/users/register/free で無料アカウントを作成（無料枠: ストレージ25GB・月間帯域25GB）
2. ダッシュボードの「Product Environment Credentials」から次の3つをコピー
   - Cloud Name
   - API Key
   - API Secret
3. ローカルで試す場合は `.env.example` を `.env` にコピーして値を埋める
   ```bash
   cp .env.example .env
   ```
4. Render/Railway等にデプロイする場合は、ダッシュボードの環境変数（Environment Variables）に同じ3つを設定する
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`

これで画像はサーバーのディスクを一切使わず、Cloudinary側に保存されるようになります。圧縮とCloudinaryの組み合わせにより、Renderなどの無料プランのディスク容量やRailwayの0.5GB制限を心配する必要はほぼなくなります。

---

## ローカルで動かす

```bash
npm install
npm start
```

ブラウザで `http://localhost:3000` を開きます。別のブラウザ／シークレットウィンドウで別のメールアドレスでログインすると、2人のユーザーとして会話・通話を試せます。

---

## デプロイできるサイト

Socket.IO はWebSocketの永続接続を使うため、**常時起動するサーバー（Node.jsプロセス）を維持できるホスティング**を選ぶ必要があります。Vercel / Netlify のようなサーバーレス系はWebSocketの永続接続に不向きなので基本的に非推奨です。

### おすすめ（無料枠あり・WebSocket対応）

1. **Render** (https://render.com)
   - 「New +」→「Web Service」→ このリポジトリを接続
   - Build Command: `npm install`
   - Start Command: `npm start`
   - 無料プランはしばらく使わないとスリープします（再アクセス時に起動に数十秒かかることがあります）

2. **Railway** (https://railway.app)
   - 「New Project」→「Deploy from GitHub repo」
   - 自動的に `npm install && npm start` を検出して起動します
   - 無料枠は使用量ベース（クレジット制）

3. **Fly.io** (https://fly.io)
   - `fly launch` でDockerfileなしでもNode.jsアプリを自動検出してデプロイ可能
   - WebSocketも問題なく利用可能

4. **Glitch** (https://glitch.com)
   - コードをそのままアップロードしてすぐ動かせる、試作向けのサービス
   - 常時稼働ではないため本番向きではありません

### 適さないサービス
- **Vercel / Netlify**: サーバーレス関数ベースで、Socket.IOの永続WebSocket接続の運用に工夫が必要（不可能ではないですが標準構成では動きません）。静的サイトやAPIのみのプロジェクト向けです。

### デプロイ時のチェックリスト
- [ ] `package.json` の `start` スクリプトが `node server.js` になっている（設定済み）
- [ ] `PORT` は環境変数から取得している（設定済み： `process.env.PORT`）
- [ ] 画像アップロードを本番運用するなら外部ストレージへの切り替えを検討
- [ ] HTTPS化（Render/Railway/Fly.ioは自動でHTTPS化されます）

---

## ディレクトリ構成

```
hanabi-chat/
├── server.js          Express + Socket.IO サーバー
├── package.json
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js          フロントエンド（バニラJS + Socket.IOクライアント）
├── uploads/             画像アップロード保存先
└── db.json               (自動生成) 簡易データベース
```
