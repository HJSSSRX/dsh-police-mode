# start-board.ps1 — 后台启动实时答题看板（脱离 DSH 进程，重启 DSH 不消失）
# 用法：
#   & 'E:\电子取证\50-scripts\start-board.ps1'            # 自动跟随最新 run（推荐）
#   & 'E:\电子取证\50-scripts\start-board.ps1' -Run <run-id>
#   & 'E:\电子取证\50-scripts\start-board.ps1' -Stop
param(
    [string]$Run = '',
    [int]$Port = 8766,
    [switch]$Stop
)
$ErrorActionPreference = 'Continue'
$node = (Get-Command node).Source
$script = Join-Path $PSScriptRoot 'board.mjs'
$log = Join-Path $env:TEMP 'board.log'

if ($Stop) {
    Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'board\.mjs' } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host ('stopped ' + $_.ProcessId)
    }
    exit 0
}

# 已有实例则先停
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'board\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$argLine = if ($Run) { '--run "' + $Run + '" --port ' + $Port } else { '--auto --port ' + $Port }
$cmd = 'cmd.exe /c start "" /min "' + $node + '" "' + $script + '" ' + $argLine + ' >> "' + $log + '" 2>&1'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd } | Out-Null
Start-Sleep -Seconds 2
try {
    $r = Invoke-WebRequest ('http://127.0.0.1:' + $Port + '/data') -UseBasicParsing -TimeoutSec 6
    $d = $r.Content | ConvertFrom-Json
    Write-Host ('看板已启动: http://127.0.0.1:' + $Port + '/')
    Write-Host ('当前 run: ' + $d.run + '  题数: ' + $d.stats.total + '  已答: ' + $d.stats.answered)
} catch {
    Write-Host ('启动失败，日志: ' + $log)
}
