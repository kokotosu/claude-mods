# claude-mods

kokot が作った Claude Code 用の mod 集です。

| mod | できること |
| --- | --- |
| usage-band | 入力欄の上に、残りの使用量（5時間枠・週枠・コンテキスト）とリセットまでの時間を帯で表示する。7日間のトークンを何に使ったかの円グラフも出す。チャット名の色分けもする |
| chat-time | LINE のように、各メッセージの下に送った日時を表示する |
| ja-questions | Claude からの質問が英語なら、日本語に訳して表示する |
| push-to-talk | 決めたキーを押している間だけ録音して、話した内容を入力欄に入れる |
| shield | 危ない操作（フォルダごと削除・履歴の上書き・秘密ファイルの書き換えなど）は止めて確認し、Claude が書いたファイルは自動で構文チェックする。ほかの作業中のチャットも表示し、名前を押すとそのチャットへ飛べる。守るもの・守れないものは [shield/SAFETY.md](shield/SAFETY.md) |

## 別のパソコンに入れる方法

ログインはいりません。ほしい mod だけ選んで入れられます。

1. ターミナルで、まず棚の登録を打つ（1回だけ）
2. そのあと、ほしい mod の行だけ打つ

```bash
claude plugin marketplace add kokotosu/claude-mods
```

```bash
claude plugin install usage-band@kokot-claude-mods
```

```bash
claude plugin install chat-time@kokot-claude-mods
```

```bash
claude plugin install ja-questions@kokot-claude-mods
```

```bash
claude plugin install push-to-talk@kokot-claude-mods
```

```bash
claude plugin install shield@kokot-claude-mods
```

3. Claude を開き直す

Claude に頼むなら「GitHub の kokotosu/claude-mods から chat-time だけ入れて」のように言えば入れてくれる。

## 更新したとき

```bash
claude plugin marketplace update kokot-claude-mods
```

そのあと `claude plugin update <mod名>@kokot-claude-mods` を打つ。

## 注意

- chat-time と usage-band の円グラフは Node.js が要る
- push-to-talk は Windows 専用
- shield のチャットへ飛ぶボタンは、パソコンの Claude アプリで押したときだけ効く
- チャット名の色分けを前のパソコンと同じにしたいときは、`~/.claude/mods/chat-colors.json` もコピーする
