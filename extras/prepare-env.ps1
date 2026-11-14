# prepare-env.ps1 — 所长模式 · 开赛前一键准备
# 用法：
#   & 'E:\电子取证\50-scripts\prepare-env.ps1'              # 只起火眼套件
#   & 'E:\电子取证\50-scripts\prepare-env.ps1' -Emulator    # 额外起 Android 模拟器 + frida
# 说明：Electron 类火眼程序必须用 cmd /c start 启动（直接 Start-Process 会静默退出），
#       且 TEMP 必须是 C:\tmp（短路径会导致锁文件/NSIS 写临时文件失败）。

[CmdletBinding()]
param(
    [switch]$Emulator
)

$ErrorActionPreference = 'Continue'
$env:TEMP = 'C:\tmp'
$env:TMP = 'C:\tmp'
$sdk = 'E:\android-sdk'

function Start-Detached([string]$exe, [string]$name) {
    if (-not (Test-Path $exe)) { Write-Host ("[MISS] " + $name + " -> " + $exe); return }
    $running = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe } | Select-Object -First 1
    if ($running) { Write-Host ("[RUN ] " + $name); return }
    # 用 WMI 创建（DSH 终端里 Start-Process/cmd start 对 Electron 应用会静默退出）
    $line = 'cmd.exe /c "set TEMP=C:\tmp&& set TMP=C:\tmp&& start "" "' + $exe + '""'
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line } | Out-Null
    Write-Host ("[START] " + $name)
    Start-Sleep -Seconds 8
}

Write-Host '=== 1. 火眼套件 ==='
Start-Detached 'E:\存档\Forensix\APPAnalysis\APPAnalysis.exe' 'APPAnalysis'
Start-Detached 'C:\Program Files\Honglian\DatabaseRecovery\DatabaseRecovery.exe' 'DatabaseRecovery'
Start-Detached 'E:\存档\Forensix\GoldenEyes\app\GoldenEyesV4.exe' 'GoldenEyes'
Start-Detached 'E:\存档\Forensix\WebMatrix\WebMatrixV5.exe' 'WebMatrix'
Start-Detached 'E:\存档\Forensix\BootMagixV4\BootMagixV4.exe' 'BootMagix'

Write-Host '=== 2. 健康检查 ==='
Start-Sleep -Seconds 15
$cli = 'E:\存档\Forensix\APPAnalysis\skills\bin\thunder-app-cli.exe'
try {
    $h = & $cli health 2>$null | Out-String | ConvertFrom-Json
    Write-Host ("APPAnalysis CLI : " + $(if ($h.success) { $h.data.status + " / " + $h.data.api_version } else { "FAIL" }))
} catch { Write-Host 'APPAnalysis CLI : FAIL' }

$drMaster = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'DatabaseRecovery\\master\.exe' } | Select-Object -First 1
if ($drMaster -and $drMaster.CommandLine -match '--port=(\d+)') {
    $port = $Matches[1]
    try {
        $r = Invoke-WebRequest ("http://127.0.0.1:" + $port + "/api/v1/app/options") -UseBasicParsing -TimeoutSec 8
        Write-Host ("DatabaseRecovery : master :" + $port + " -> HTTP " + $r.StatusCode)
    } catch { Write-Host ("DatabaseRecovery : master :" + $port + " -> 未授权/未就绪（需在界面登录一次）") }
} else { Write-Host 'DatabaseRecovery : master 未启动' }
if (Test-Path 'E:\存档\Forensix\WebMatrix\skills\wmx-bill-analysis\bin\wmx.cmd') {
    & 'E:\存档\Forensix\WebMatrix\skills\wmx-bill-analysis\bin\wmx.cmd' status *> $null
    Write-Host ("WebMatrix wmx    : " + $(if ($LASTEXITCODE -eq 0) { 'OK' } else { '需登录/检查' }))
}

Write-Host '=== 3. 基础工具 ==='
Write-Host ("cn        : " + (Test-Path 'E:\电子取证\50-scripts\cn.mjs'))
Write-Host ("ev        : " + (Test-Path 'E:\电子取证\50-scripts\ev.mjs'))
Write-Host ("questions : " + (Test-Path 'E:\电子取证\40-work\questions\2024数证杯初赛.jsonl'))
Write-Host ("WSL frida : " + (Test-Path 'E:\android-sdk\frida\frida-server'))

if ($Emulator) {
    Write-Host '=== 4. Android 模拟器 ==='
    & 'E:\android-sdk\start-emulator.ps1' 2>&1 | Select-Object -Last 3
}

Write-Host '=== 2.5 其它火眼产品 ==='
Start-Detached 'E:\存档\Forensix\HackFindx\HackFindxNextV7.exe' '网探'
Start-Detached 'E:\存档\Forensix\IoTforensic\IoTforensic.exe' '物联网'
Start-Detached 'E:\存档\Forensix\ThunderCloud\ThunderCloud.exe' '雷电云'
Start-Detached 'E:\存档\Forensix\VideoForensic\VideoForensic.exe' '视频取证'

Write-Host '=== 2.6 实时答题看板 ==='
try { Invoke-WebRequest 'http://127.0.0.1:8766/data' -UseBasicParsing -TimeoutSec 3 | Out-Null; Write-Host '看板已在运行' } catch { & 'E:\电子取证\50-scripts\start-board.ps1' 2>&1 | Select-Object -Last 2 }
Write-Host '=== 准备完成 ==='
