// What counts as dangerous: a shell command that destroys what cannot be got
// back, and a file that holds secrets. Each rule says, in plain words, what
// would happen, for the question the person is asked.
//
// The rules read the command's text. A command built at run time (a name
// kept in a variable, a script written to a file first) is not seen.

export type Danger = { what: string }

type Rule = { test: RegExp; what: string }

// A flag that means "and everything inside": `-r`, `-rf`, `-fR`, `--recursive`,
// and PowerShell's `-Recurse` and its short forms. `-Force` is not one.
const RECURSIVE = String.raw`(?<!\S)(?:-(?!force\b)[a-z]{0,3}r[a-z]{0,3}|--recursive|-rec[a-z]*)(?=\s|$)`

// The delete commands of bash, cmd and PowerShell, including its short names.
const REMOVE = new RegExp(String.raw`(?:^|[\s;&|("'\x60])(?:rm|ri|del|erase|rd|rmdir|Remove-Item)\s+(?=[^|;&]*${RECURSIVE})`, 'i')

// A short flag cluster holding `f`, as in `-f` and `-uf`.
const PUSH_FORCE = /\bgit\s+push\b[^|;&]*(\s--force\b|\s-(?!-)[a-z]*f[a-z]*(?=\s|$)|\s\+\S|\s--mirror\b)/i
const PUSH_DELETE = /\bgit\s+push\b[^|;&]*(\s--delete\b|\s-(?!-)[a-z]*d[a-z]*(?=\s|$)|\s:\S)/i

const SHELLS = String.raw`(sh|bash|zsh|iex|Invoke-Expression|python[\d.]*|node|perl|ruby)`

const COMMANDS: Rule[] = [
  { test: REMOVE, what: 'フォルダごと消す' },
  { test: /\b(rd|rmdir)\s+[^|;&]*\/s\b/i, what: 'フォルダごと消す' },
  { test: /\bdel\s+[^|;&]*\/s\b/i, what: 'フォルダの中のファイルをまとめて消す' },
  { test: /\bfind\b[^|;&]*\s(-delete\b|-exec(dir)?\s+rm\b)/i, what: '見つけたファイルをまとめて消す' },
  { test: /\|\s*xargs\s+(-\S+\s+)*rm\b/i, what: '見つけたファイルをまとめて消す' },
  { test: /\b(mv|move|Move-Item)\b[^|;&]*\s(\/dev\/null|NUL|\$null)(?=\s|$)/i, what: 'ファイルを行き先のない場所へ移して消す' },
  {
    test: /\b(shutil\.rmtree|rimraf|FileUtils\.rm_r?f?|rmSync\([^)]*recursive|fs(\.promises)?\.rm(dir)?\([^)]*recursive|Directory\.Delete\([^)]*true)/i,
    what: 'プログラムを使ってフォルダごと消す',
  },
  { test: PUSH_FORCE, what: 'GitHub の履歴を上書きする' },
  { test: PUSH_DELETE, what: 'GitHub のブランチを消す' },
  { test: /\bgit\s+(filter-branch|filter-repo)\b/i, what: '履歴をまるごと書き換える' },
  { test: /\bgit\s+reset\s+[^|;&]*--hard\b/i, what: 'まだ保存していない変更を捨てる' },
  { test: /\bgit\s+clean\s+[^|;&]*-\w*f/i, what: '管理していないファイルを消す' },
  { test: /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i, what: 'まだ保存していない変更を捨てる' },
  { test: /\bgit\s+branch\s+[^|;&]*-D\b/, what: 'ブランチを強制的に消す' },
  { test: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, what: 'データベースの中身を消す' },
  { test: /\bformat(\.com)?\s+[a-z]:|\b(diskpart|mkfs(\.\w+)?|Format-Volume|Clear-Disk)\b/i, what: 'ドライブを初期化する' },
  { test: /\bdd\s+[^|;&]*\bof=\/dev\//i, what: 'ディスクに直接書き込む' },
  {
    test: new RegExp(String.raw`\b(curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^|]*\|\s*${SHELLS}\b`, 'i'),
    what: 'ネットから落としたものをそのまま実行する',
  },
  {
    test: new RegExp(String.raw`\bbase64\s+(-d|-D|--decode)\b[^|]*\|\s*${SHELLS}\b|FromBase64String[\s\S]*\b(iex|Invoke-Expression)\b|\b(powershell|pwsh)(\.exe)?\b[^|;&]*\s-e(nc|ncodedcommand)?\s`, 'i'),
    what: '中身を隠した命令をそのまま実行する',
  },
  { test: /\b(reg\s+delete|Remove-ItemProperty\s+[^|;]*HK(LM|CU))\b/i, what: 'Windows の設定（レジストリ）を消す' },
  { test: /\bshutdown(\.exe)?\s+[/-][srh]\b|\b(Stop-Computer|Restart-Computer)\b/i, what: 'パソコンを止める・再起動する' },
]

// A program that runs the text it is given: what is quoted after it is a command too.
const RUNS_QUOTED =
  /(?:^|[\s;&|(])(bash|sh|zsh|dash|fish|cmd(\.exe)?|powershell(\.exe)?|pwsh|eval|iex|Invoke-Expression|Invoke-Command|Start-Process|python[\d.]*|py|node|deno|bun|ruby|perl|php|ssh|watch|su|sudo|wsl|xargs|psql|mysql|mariadb|sqlite3|sqlcmd|mongo|mongosh|redis-cli)(?=[\s;&|)]|$)/i

// Quoted text is only words: a message that mentions `rm -rf` is not that
// command, and `rm -rf "my dir"` is still one. A quoted word without spaces
// is kept as the word, and `$(…)` inside double quotes runs, so it is kept.
function unquoted(command: string): string {
  return command.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (all, double?: string, single?: string) => {
    const inner = double ?? single ?? ''
    if (double !== undefined && /\$\(|`/.test(inner)) return all
    return /\s/.test(inner) ? '""' : inner
  })
}

// Files that hold keys or passwords, by name.
const SECRETS =
  /(^|[\\/])(\.env(\.[\w.-]+)?|id_(rsa|ed25519|ecdsa)(\.pub)?|[^\\/]+\.(pem|key|p12|pfx|jks|keystore)|credentials(\.json)?|\.git-credentials|secrets?\.(json|ya?ml|toml|txt|ini|env)|[^\\/]*service[-_]?account[^\\/]*\.json|[^\\/]*adminsdk[^\\/]*\.json|\.npmrc|\.netrc|\.pypirc|\.htpasswd)$|[\\/]\.ssh[\\/]/i

export function dangerOf(command: string): Danger | null {
  const bare = unquoted(command)
  const seen = RUNS_QUOTED.test(bare) ? command : bare
  const rule = COMMANDS.find(({ test }) => test.test(seen))

  return rule === undefined ? null : { what: rule.what }
}

export function isSecret(path: string): boolean {
  return SECRETS.test(path)
}
