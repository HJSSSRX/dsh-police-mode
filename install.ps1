# install.ps1 — 把所长模式脚本安装到本机固定目录
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Dir D:\dsh-forensic
# 说明：cordis.patch.yml 默认引用 C:\dsh-forensic\；若用 -Dir 改成其它目录，
#       请同步把 cordis.patch.yml 里的 C:\dsh-forensic\ 全部替换成新目录。
param(
    [string]$Dir = 'C:\dsh-forensic'
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host "安装目录: $Dir"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'docs') | Out-Null

Copy-Item (Join-Path $root 'scripts\*.mjs') $Dir -Force
Copy-Item (Join-Path $root 'scripts\*.ps1') $Dir -Force`r`nCopy-Item (Join-Path $root 'doctor.ps1') $Dir -Force
Copy-Item (Join-Path $root 'docs\*') (Join-Path $Dir 'docs') -Recurse -Force
Copy-Item (Join-Path $root 'extras\*') $Dir -Force -ErrorAction SilentlyContinue

Write-Host '自检:'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Write-Host ('  node: ' + $node.Source) } else { Write-Host '  [警告] 未找到 node（ans/board/cn 需要 Node.js >= 20）' }
foreach ($f in @('ans.mjs', 'board.mjs', 'cn.mjs')) {
    $p = Join-Path $Dir $f
    if (Test-Path $p) { Write-Host ("  " + $f + ": OK") } else { Write-Host ("  " + $f + ": MISSING") }
}
foreach ($f in @('heavy.ps1', 'sysgauge.ps1', 'start-board.ps1')) {
    $p = Join-Path $Dir $f
    if (Test-Path $p) { Write-Host ("  " + $f + ": OK") } else { Write-Host ("  " + $f + ": MISSING") }
}

Write-Host ''
Write-Host '下一步：'
Write-Host '  1) DSH → Plugins → Add plugin → 选择本仓库目录（或 plugin_manager install_bundle，target=本仓库绝对路径）'
Write-Host '  2) 新开会话，模式选择「所长模式」'
Write-Host "  3) 开赛先跑: & 'C:\dsh-forensic\start-board.ps1'  → http://127.0.0.1:8766/"
Write-Host '  4) 资源与重工具: sysgauge.ps1 -Json / heavy.ps1 -Name <name> -Cmd "<command>"'