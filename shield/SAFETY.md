# shield が守るもの・守れないもの

shield は、Claude が実行しようとした命令とファイルの書き換えを、実行の前に見ます。
危ないものは止めて「実行しますか？」と聞き、あなたが「実行する」を選んだときだけ通します。

この資料は、**何を止めて、何を止めないか**を、実際に試した命令つきで並べたものです。
ここに載っている命令はすべて、shield に付いている自動の試験（`tests/shield.test.ts`）で確かめています。

---

## 1. 止めるもの

| 起きること | 例 |
|---|---|
| フォルダごと消す | `rm -rf ./project`、`rm -r ./project`、`Remove-Item -Recurse C:\work`、`ri -r C:\work`、`rmdir /s old` |
| 見つけたファイルをまとめて消す | `find . -delete`、`find . -exec rm {} \;`、`ls \| xargs rm` |
| ファイルを行き先のない場所へ移して消す | `mv important.txt /dev/null`、`Move-Item a.txt $null` |
| プログラムを使ってフォルダごと消す | `python -c "shutil.rmtree(...)"`、`node -e "fs.rmSync(..., {recursive:true})"` |
| GitHub の履歴を上書きする | `git push --force`、`git push -f`、`git push -uf origin main`、`git push --mirror` |
| GitHub のブランチを消す | `git push origin --delete feature`、`git push origin :feature` |
| 履歴をまるごと書き換える | `git filter-branch`、`git filter-repo` |
| まだ保存していない変更を捨てる | `git reset --hard`、`git checkout -- .` |
| 管理していないファイルを消す | `git clean -fd` |
| ブランチを強制的に消す | `git branch -D feature` |
| データベースの中身を消す | `DROP TABLE`、`TRUNCATE TABLE`（`psql -c "..."` の中に書いても止める） |
| ドライブを初期化する・ディスクに直接書き込む | `format d:`、`diskpart`、`dd of=/dev/sda` |
| ネットから落としたものをそのまま実行する | `curl ... \| bash`、`iwr ... \| iex` |
| 中身を隠した命令をそのまま実行する | `echo ... \| base64 -d \| sh`、`powershell -enc ...` |
| Windows の設定（レジストリ）を消す | `reg delete ...` |
| パソコンを止める・再起動する | `shutdown /s`、`Restart-Computer` |

かっこ（`"…"`）の中に書いた命令でも、`bash -c`、`ssh`、`sudo`、`psql` などに渡して**実際に実行されるもの**は止めます。

### 書き換える前に聞くファイル（パスワードや鍵が入るもの）

`.env` `.env.local` ／ `.ssh` フォルダの中 ／ `id_rsa` などの鍵 ／ `*.pem` `*.key` `*.p12` `*.pfx` `*.jks` ／
`credentials.json` ／ `.git-credentials` ／ `secrets.json` `secrets.yaml` など ／ `service-account*.json` ／ `*adminsdk*.json` ／
`.npmrc` `.netrc` `.pypirc` `.htpasswd`

---

## 2. 止めないもの（止めすぎないように）

ふだんの作業を邪魔しないため、次のものは**聞かずに通します**。

| 命令 | 通す理由 |
|---|---|
| `rm notes.txt`、`rm -f my-report.txt` | ファイル1つだけを消す |
| `Remove-Item -Force a.txt` | `-Force` は「中身ごと」ではない |
| `git push origin main`、`git push -u origin main` | ふつうの送信 |
| `git commit -m "remove rm -rf from script"` | 文章の中に書いてあるだけ |
| `echo "rm -rf は危ない" > memo.txt` | 文章の中に書いてあるだけ |
| `ls -rf`、`npm run format`、`git status` | 消す命令ではない |

---

## 3. 守れないもの

shield は**命令の文字の形**を見て判断します。そのため、次のものは見分けられません。

| すり抜けるもの | 例 | 理由 |
|---|---|---|
| 名前を置き換えた命令 | `X=rm; $X -rf proj` | 実行するまで中身が決まらない |
| ファイルに書いてから実行する命令 | `python cleanup.py`、`sh ./wipe.sh` | shield に見えるのはファイル名だけ |
| 知らない書き方の命令 | 上の表にない道具や書き方 | 一覧にないものは分からない |
| ファイル名で判断できない秘密 | `token.txt`、`tokens.json` | ふつうのファイルと見分けがつかない |

shield は**シートベルトであって、金庫ではありません**。
Claude がふだんの作業で「うっかり」危ない命令を出したときに止めるためのものです。わざと隠した命令まで防ぐことはできません。
大事なデータは、shield とは別にバックアップを取っておいてください。

---

## 4. 一番安全な側に倒れる作り

- **見張りが動かなかったら、止めます。** shield の中で問題が起きて判断できないときは、通さずに止めます。
- **答える人がいなかったら、止めます。** 「実行しますか？」の質問が閉じられたり、誰も答えられなかったりしたときは「やめる」として扱います。
- **どこにも何も送りません。** 判断はすべてパソコンの中だけで行います。命令やファイルの中身をネットに送ることはありません。
- **中身を読めます。** 止めるルールはすべて `hooks/rules.ts` の1つのファイル（約90行）にまとまっています。

---

## 5. すり抜け方を見つけたら

shield を通り抜ける危ない命令を見つけたら、教えてください。
見つかった命令は試験に足して、二度と通らないようにします。
