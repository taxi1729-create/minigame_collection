# あそびばこ — 単発ミニゲーム集

スマホのブラウザですぐ遊べるミニゲーム集です。ホーム画面に追加するとアプリアイコンで起動できます。

## タイトル画面（左右スワイプで切替）

| タブ | 内容 |
|---|---|
| みんなで遊ぶ | 一番上のシークバーで人数（1〜8人）とプレイヤー名を決める。その人数で遊べるゲームが上に並び、おすすめ人数のゲームには「おすすめ」 |
| 1人で遊ぶ | ひとり用ゲームと自己ベスト。「1人でも遊べる」棚から開くと、人数設定はそのままで1人で始まる |
| 成績 | 自分と他のプレイヤーの成績（遊んだ回数・勝ち/クリア・勝率・ゲーム別の最高記録・最近の記録） |
| 設定変更 | 基本プレイヤー名、追加プレイヤー名、効果音の音量、使用するAI（Claude / Gemini）とそれぞれのAPIキー・モデル名、クラウドセーブ、バックアップ |

どのゲームも上部の **ホーム** で進行状況をセーブしてタイトルへ戻り、「つづきから」で再開できます。

## 収録ゲーム

| ゲーム | 人数 | 内容 |
|---|---|---|
| あいまいアンサー | 3〜8人 | 伝えすぎたら0点。一部の人だけに当たるヒントを出す |
| 無言トーク | 2人〜 | しゃべらずに3分でエピソードを伝える |
| 異種伝言ゲーム | 2〜7人 | 人ごとに違う表現手段で伝える伝言ゲーム |
| 同母音異義語ゲーム | 1〜6人 | 同じ母音の言葉をヒントから当てる |
| 嘘雑学クイズ | 1〜8人 | 本物そっくりのウソ雑学を見破る。1周＝5問、ウソの数は最後まで秘密 |
| ダウトニュース | 1〜8人 | 直近24時間のニュース4本から1本のニセを見破る。1周＝3問。ニュースは選んだAIのWeb検索で取得し、24時間ごとに更新（キーが無ければ練習モード） |
| 文字バトラー | 1〜4人 | キャラ名・見た目・性格・武器・能力（各6文字）からAIがキャラを作り、実況つきで対決。1人なら敵キャラと。実況の長さを選べる |
| ピタッと10秒 | 1人 | 見えないストップウォッチを10.00秒で止める（5回勝負） |
| いろことば | 1人 | 文字ではなくインクの色を答える30秒チャレンジ |
| すべらせパズル | 1人 | 3×3 / 4×4 のスライドパズル |

## AI

AIを使うゲーム（同母音異義語・嘘雑学クイズ・ダウトニュース・異種伝言・無言トーク・文字バトラー）は、設定変更で選んだAIとモデルで動きます。

- 使用するAI：Claude か Gemini をボタンで選択
- **サーバのキー**：Cloudflare に登録したAPIキー・モデル名を、合言葉を入れた人だけが使える（キーはブラウザに渡らない）
- **自分のキー（任意）**：設定変更でAPIキーとモデル名を入れると、サーバのキーより優先して使う
- 呼び出しは `Kit.ai.ask({ system, prompt, json, search, maxTokens })` に集約（`search:true` でWeb検索付き）

## セーブとクラウド

- セーブデータ（プレイヤー名・成績・途中セーブ・自己ベスト）は1つのJSONにまとめて端末に保存します。
- **クラウドセーブ（GitHub Gist）**：設定変更タブで GitHub のトークン（Fine-grained token、権限は「Gists: Read and write」のみ）を入れると、自分のGitHubに非公開Gistを1つ作って同期します。別の端末でも同じトークンで接続すれば成績が合算されます。
  - 統合ルール：成績は記録ごとに合算（消した記録は消えたまま）、途中セーブ・自己ベスト・プレイヤー名は新しい方を採用
  - トークンとAPIキーは同期しません（端末にだけ保存）
- バックアップの書き出し／読み込み（JSONファイル）もできます。

## 公開（Cloudflare Workers）

GitHub の `main` に push すると、Cloudflare が自動でビルド・公開します。`public/` がサイト本体、`src/worker.js` が `/api/*` を処理します。

### 初回の設定（Cloudflare の画面）

1. **Workers & Pages → Create application → GitHub** を選び、このリポジトリを接続する。Worker の名前は `asobibiako`（`wrangler.jsonc` の `name` と同じにする。違うとビルドが失敗する）
2. 作った Worker の **Settings → Variables and Secrets** に登録して、Deploy する

   | 名前 | 種類 | 中身 |
   |---|---|---|
   | `GAME_PASSCODE` | Secret | 合言葉 |
   | `CLAUDE_API_KEY` | Secret | Claude のAPIキー |
   | `GEMINI_API_KEY` | Secret | Gemini のAPIキー（使わないなら省略可） |
   | `AI_PROVIDER` | Text | `claude` または `gemini`（初期値） |
   | `CLAUDE_MODEL` / `GEMINI_MODEL` | Text | モデル名 |

3. **Cloudflare Access** でサイト全体をログイン制にする：Worker の **Settings → Domains & Routes** で workers.dev（とプレビューURL）の Cloudflare Access を有効にし、許可するメールアドレスをポリシーに追加する

### API

| パス | 内容 |
|---|---|
| `GET /api/config` | サーバに登録されたAIの有無・モデル名（キーは返さない） |
| `POST /api/auth` | 合言葉の確認（8回間違えると5分ロック） |
| `POST /api/ai` | ヘッダ `x-game-passcode` が正しいときだけ、サーバのキーで Claude / Gemini に中継（`search:true` でWeb検索） |

### 手元で試す

```bash
npm install
cp .dev.vars.example .dev.vars   # 合言葉とキーを書く（.gitignore 済み）
npm run dev                       # http://localhost:8787
```

## 構成

```
wrangler.jsonc                 Cloudflare Workers の設定
src/worker.js                  /api/*（合言葉・AI中継）
public/index.html              タイトル（4タブ）
public/manifest.webmanifest    ホーム画面追加用
public/icons/                  アプリアイコン
public/kit/kit.css             共通UI（段ボール＋紙ラベル＋二色ズレ影、ライトモード専用）
public/kit/kit.js              共通機能：効果音・セーブ・成績・設定・AI・クラウド同期・ホームボタン・演出
public/games/<id>/index.html   各ゲーム
```

### 新しいゲームを追加するとき

1. `public/games/<id>/index.html` を作り、`../../kit/kit.css` と `../../kit/kit.js` を読み込む（`<body class="kit">`）
2. `Kit.mount({ id, title, onSave })` でホームボタン付きのバーを出す。`onSave` は途中経過を返す（終わっていれば `null`）。起動時に `Kit.load(id)` で再開
3. 人数と名前は `Kit.settings.get().partySize` と `Kit.players(n)`、APIキーは `Kit.settings.get().keys`
4. 終了時に `Kit.record({ game, player, result:'win'|'lose'|'clear'|'fail'|'play', score, detail, group })`、演出は `Kit.celebrate()` / `Kit.fail()`
5. `public/index.html` の `GAMES` 配列に1行追加（`min` / `max` / おすすめ人数）
