# sysgauge.ps1 — 所长专用的资源仪表（每 10 分钟调度节拍用）
# 用法：
#   & 'E:\电子取证\50-scripts\sysgauge.ps1'          # 人类可读
#   & 'E:\电子取证\50-scripts\sysgauge.ps1' -Json    # 一行 JSON，便于解析
# 输出：CPU%、空闲内存、磁盘队列、重工具锁、DSH 子进程数、建议新增槽位、状态(UP/HOLD/DOWN)
param([switch]$Json)
$ErrorActionPreference = 'Continue'

function AvgCounter([string]$path, [int]$samples = 3) {
    try {
        $c = Get-Counter $path -SampleInterval 1 -MaxSamples $samples -ErrorAction Stop
        ($c.CounterSamples | Measure-Object -Property CookedValue -Average).Average
    } catch { $null }
}

$cpu = AvgCounter '\Processor(_Total)\% Processor Time' 3
$disk = AvgCounter '\PhysicalDisk(_Total)\Current Disk Queue Length' 1
$os = Get-CimInstance Win32_OperatingSystem
$freeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$totalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)

$dshIds = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$children = @()
if ($dshIds.Count -gt 0) {
    $children = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($dshIds -contains $_.ParentProcessId) -and $_.Name -match 'powershell|pwsh|node|python|7z|7za|UnRAR|jadx|java|wsl|cmd'
    })
}
$heavyLock = Test-Path 'C:\tmp\heavy.lock'
$topRam = (Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 |
    ForEach-Object { $_.Name + ':' + [math]::Round($_.WorkingSet64 / 1MB, 0) + 'M' }) -join ', '

$cpuV = if ($cpu -ne $null) { [math]::Round($cpu, 0) } else { $null }
$diskV = if ($disk -ne $null) { [math]::Round($disk, 2) } else { $null }

# 判定：留 4GB 给系统；每多一个 agent 约 1.2GB 余量（含工具子进程）
$ramSlots = [math]::Max(0, [math]::Floor(($freeGB - 5) / 1.2))
$cpuOk = ($cpuV -ne $null -and $cpuV -lt 70)
$diskOk = ($diskV -ne $null -and $diskV -lt 2)
$state = 'HOLD'
$recommend = 0
if (($freeGB -lt 5) -or ($cpuV -ne $null -and $cpuV -gt 90) -or ($diskV -ne $null -and $diskV -gt 3)) { $state = 'DOWN' }
elseif ($cpuOk -and $diskOk -and -not $heavyLock -and $ramSlots -ge 1) { $state = 'UP'; $recommend = [math]::Min($ramSlots, 4) }

$result = [ordered]@{
    at             = (Get-Date -Format 'HH:mm:ss')
    state          = $state
    recommend_slots = $recommend
    cpu_pct        = $cpuV
    ram_free_gb    = $freeGB
    ram_total_gb   = $totalGB
    disk_queue     = $diskV
    heavy_lock     = $heavyLock
    dsh_children   = $children.Count
    dsh_child_kinds = (($children | Group-Object Name | ForEach-Object { $_.Name + ':' + $_.Count }) -join ',')
    top_ram        = $topRam
}
if ($Json) { $result | ConvertTo-Json -Compress } else { $result | Format-List }
