# heavy.ps1 — 重工具串行锁 + 低优先级执行（防止并发把机器拖死）
# 用法：
#   & 'E:\电子取证\50-scripts\heavy.ps1' -Name 7z -Cmd "7z x V:\x.zip -oC:\tmp\x" 
#   & 'E:\电子取证\50-scripts\heavy.ps1' -Name tsk -Cmd "wsl -d Ubuntu-22.04 -u root -- fls -r -o 2048 /mnt/ev/img"
# 规则：全局同一时刻只允许 1 个重工具；后来者排队（最长 30 分钟）；进程优先级 BelowNormal。
param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Cmd,
    [int]$TimeoutMin = 30
)
$ErrorActionPreference = 'Continue'
$lock = Join-Path $env:TEMP 'heavy.lock'
$log = Join-Path $env:TEMP 'heavy.log'
function Log([string]$m) { try { Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) -Encoding UTF8 } catch {} }

$sw = [Diagnostics.Stopwatch]::StartNew()
$held = $false
while (-not $held) {
    try {
        $fs = [IO.File]::Open($lock, 'CreateNew', 'Write', 'None')
        $fs.Close(); $held = $true
    } catch {
        if ($sw.Elapsed.TotalMinutes -gt $TimeoutMin) { Log ("[$Name] lock timeout, run anyway"); break }
        Start-Sleep -Milliseconds 700
    }
}
Log ("[$Name] acquired after " + [math]::Round($sw.Elapsed.TotalSeconds, 1) + "s: " + $Cmd.Substring(0, [Math]::Min(120, $Cmd.Length)))
try {
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $Cmd -NoNewWindow -PassThru
    try { (Get-Process -Id $p.Id).PriorityClass = 'BelowNormal' } catch {}
    $p.WaitForExit()
    Log ("[$Name] exit=" + $p.ExitCode)
    exit $p.ExitCode
} finally {
    if ($held) { Remove-Item $lock -Force -ErrorAction SilentlyContinue }
    Log ("[$Name] released")
}
