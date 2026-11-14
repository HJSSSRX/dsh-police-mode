# doctor.ps1 — 环境自检 / 依赖引导
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\doctor.ps1           # 只检查，打印缺失项与安装命令
#   powershell -ExecutionPolicy Bypass -File .\doctor.ps1 -Install  # 自动安装可自动装的部分（node/7z/python/pip 包）
# 说明：火眼套件是商业软件，本脚本只检查不安装；WSL 取证工具给出命令由用户确认后安装。
param(
    [switch]$Install
)
$ErrorActionPreference = 'Continue'
$results = @()
function Add-Result([string]$name, [bool]$ok, [string]$detail, [string]$hint) {
    $script:results += [pscustomobject]@{ Name = $name; OK = $ok; Detail = $detail; Hint = $hint }
}
function Has-Cmd([string]$cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# ---- 基础运行时 ----
$nodeOk = $false
$nodeVer = '未安装'
if (Has-Cmd node) {
    $nodeVer = (& node --version 2>$null | Out-String).Trim()
    if ($nodeVer -match 'v(\d+)') { $nodeOk = [int]$Matches[1] -ge 20 }
}
Add-Result 'Node.js >= 20' $nodeOk $nodeVer 'winget install OpenJS.NodeJS.LTS'

$gitOk = Has-Cmd git
Add-Result 'git' $gitOk $(if ($gitOk) { (& git --version 2>$null | Out-String).Trim() } else { '未安装' }) 'winget install Git.Git'

$sevenOk = (Has-Cmd 7z) -or (Test-Path 'C:\Program Files\7-Zip\7z.exe')
Add-Result '7-Zip' $sevenOk $(if ($sevenOk) { 'OK' } else { '未安装' }) 'winget install 7zip.7zip'

# ---- Python（跳过 WindowsApps 的 python 别名桩） ----
$pyCmd = $null
$pyPrefix = @()
$pyVer = '未安装'
$pyCands = @()
if ($env:DSH_FORENSIC_PYTHON) { $pyCands += , @($env:DSH_FORENSIC_PYTHON) }
$pyCands += , @('python')
$pyCands += , @('py', '-3')
$pyCands += , @('python3')
foreach ($cand in $pyCands) {
    $exe = $cand[0]
    if (-not (Has-Cmd $exe)) { continue }
    $prefix = @()
    if ($cand.Length -gt 1) { $prefix = @($cand[1]) }
    $out = (& $exe @prefix --version 2>&1 | Out-String).Trim()
    if ($out -match 'Python\s+(\d+)\.(\d+)') {
        $pyCmd = $exe
        $pyPrefix = $prefix
        $pyVer = $out
        break
    }
}
$pipMissing = @()
if ($pyCmd) {
    $mods = @('pyewf', 'pytsk3', 'dissect', 'regipy', 'Crypto', 'capstone', 'pefile', 'scapy', 'pdfplumber', 'openpyxl', 'mnemonic', 'eth_account', 'pymysql')
    $modList = ($mods | ForEach-Object { "'" + $_ + "'" }) -join ','
    $code = "import importlib,sys;mods=[" + $modList + "];print(','.join(m for m in mods if not importlib.util.find_spec(m)))"
    $missingStr = (& $pyCmd @pyPrefix -c $code 2>$null | Out-String).Trim()
    if ($missingStr) { $pipMissing = $missingStr.Split(',') }
    Add-Result 'Python' $true $pyVer 'winget install Python.Python.3.12；或用 DSH_FORENSIC_PYTHON 指向已有解释器'
    Add-Result 'Python 取证库' ($pipMissing.Count -eq 0) $(if ($pipMissing.Count -eq 0) { '全部已装' } else { '缺: ' + ($pipMissing -join ', ') }) ('pip install ' + ($pipMissing -join ' '))
} else {
    Add-Result 'Python' $false '未安装（或只有 Microsoft Store 别名桩）' 'winget install Python.Python.3.12；或用 DSH_FORENSIC_PYTHON 指向已有解释器'
}

# ---- WSL 与 Linux 取证工具 ----
$wslOk = Has-Cmd wsl
$wslDistro = ''
$wslTools = @()
if ($wslOk) {
    $dists = @(& wsl -l -q 2>$null | Where-Object { $_ -and $_.Trim() })
    if ($dists.Count -gt 0) {
        $wslDistro = ($dists[0] -replace "`0", '').Trim()
        $toolOut = (& wsl -d $wslDistro -u root -- sh -c 'for t in fls icat mmls ewfmount xfs_db cryptsetup; do command -v $t >/dev/null 2>&1 && echo "$t:ok" || echo "$t:miss"; done' 2>$null | Out-String)
        foreach ($line in ($toolOut -split "`n")) {
            if ($line -match '^(\w+):miss') { $wslTools += $Matches[1] }
        }
    }
}
Add-Result 'WSL' $wslOk $(if ($wslOk) { '发行版: ' + $wslDistro } else { '未安装' }) 'wsl --install -d Ubuntu-22.04'
Add-Result 'WSL 取证工具' ([bool]($wslOk -and $wslTools.Count -eq 0)) $(if (-not $wslOk) { '需先装 WSL' } elseif ($wslTools.Count -eq 0) { 'fls/icat/mmls/ewfmount/xfs_db/cryptsetup 齐全' } else { '缺: ' + ($wslTools -join ', ') }) 'wsl -d Ubuntu-22.04 -u root -- apt install sleuthkit ewf-tools xfsprogs cryptsetup-bin'

# ---- 可选：火眼套件 ----
$forensix = $env:FORENSIX_HOME
$fxOk = [bool]($forensix -and (Test-Path $forensix))
Add-Result '火眼套件（可选）' $fxOk $(if ($fxOk) { $forensix } else { '未配置 FORENSIX_HOME（商业软件需自行安装）' }) '安装后设置环境变量 FORENSIX_HOME=<安装目录>'

# ---- 端口 ----
$portBusy = [bool](Get-NetTCPConnection -State Listen -LocalPort 8766 -ErrorAction SilentlyContinue)
$boardAlive = $false
if ($portBusy) {
    try { Invoke-WebRequest 'http://127.0.0.1:8766/data' -UseBasicParsing -TimeoutSec 3 | Out-Null; $boardAlive = $true } catch {}
}
Add-Result '看板端口 8766' ([bool]((-not $portBusy) -or $boardAlive)) $(if ($boardAlive) { '看板已在运行（http://127.0.0.1:8766/）' } elseif ($portBusy) { '被其它程序占用' } else { '可用' }) '占用时用 start-board.ps1 -Port 8767'

# ---- 自动安装（可选） ----
if ($Install) {
    $wingetTargets = @()
    if (-not $nodeOk) { $wingetTargets += 'OpenJS.NodeJS.LTS' }
    if (-not $sevenOk) { $wingetTargets += '7zip.7zip' }
    if (-not $pyCmd) { $wingetTargets += 'Python.Python.3.12' }
    foreach ($t in $wingetTargets) {
        Write-Host ('安装 ' + $t + ' ...')
        winget install --id $t -e --accept-package-agreements --accept-source-agreements 2>&1 | Select-Object -Last 2
    }
    if ($pipMissing.Count -gt 0 -and $pyCmd) {
        $map = @{ pyewf = 'pyewf'; pytsk3 = 'pytsk3'; dissect = 'dissect'; regipy = 'regipy'; Crypto = 'pycryptodome'; capstone = 'capstone'; pefile = 'pefile'; scapy = 'scapy'; pdfplumber = 'pdfplumber'; openpyxl = 'openpyxl'; mnemonic = 'mnemonic'; eth_account = 'eth-account'; pymysql = 'PyMySQL' }
        $pkgs = ($pipMissing | ForEach-Object { $map[$_] }) -join ' '
        Write-Host ('安装 Python 库: ' + $pkgs)
        & $pyCmd @pyPrefix -m pip install --quiet $pkgs
    }
}

# ---- 报告 ----
Write-Host ''
Write-Host '====== 环境自检 ======'
foreach ($r in $results) {
    $mark = if ($r.OK) { '[OK] ' } else { '[缺] ' }
    Write-Host ($mark + $r.Name.PadRight(18) + ' ' + $r.Detail)
    if (-not $r.OK) { Write-Host ('        -> ' + $r.Hint) }
}
Write-Host ''
$missingCount = @($results | Where-Object { -not $_.OK }).Count
if ($missingCount -eq 0) {
    Write-Host '全部就绪。下一步: 新开 DSH 会话选择「所长模式」；开赛先跑 start-board.ps1'
} else {
    Write-Host ('还缺 ' + $missingCount + ' 项。可运行: powershell -ExecutionPolicy Bypass -File .\doctor.ps1 -Install')
}
