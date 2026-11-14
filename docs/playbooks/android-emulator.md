# Android 动态分析环境（模拟器 + frida）— 已打通

> 本机环境：Windows 11 26200 / Lenovo / WHPX 可用。
> 用途：APK 动态脱壳、hook、行为分析（程序功能分析类题）。

## 一键使用

```powershell
# 1) 启动模拟器（会自动临时禁用 Npcap/VMnet 网卡）
& 'E:\android-sdk\start-emulator.ps1'

# 2) 推 frida-server 并以 root 启动
& 'E:\电子取证\50-scripts\frida-setup.ps1'

# 3) 验证
adb -s emulator-5580 shell whoami            # root
adb -s emulator-5580 shell getprop sys.boot_completed   # 1
frida-ps -U                                  # 列出进程
```

用完：

```powershell
& 'E:\android-sdk\stop-emulator.ps1'   # 停模拟器并恢复网卡
```

## 关键的四个坑（缺一不可）

1. **虚拟网卡必须临时禁用**：Npcap Loopback（`以太网 3`）、VMware `VMnet1`/`VMnet8` 会让 emulator 卡在网卡枚举（qemu 在跑、端口在听、但控制台不 accept）。禁用后 30 秒内 boot 完成。
2. **TEMP 必须是 `C:\tmp`**：默认 `C:\Users\ADMINI~1\...` 短路径写不进 netsim/feature-flags 锁文件（错误 5）。所有 adb / frida / emulator 命令前 `set TEMP=C:\tmp`。
3. **PATH 要含 `emulator\lib64`**：否则 qemu 缺 DLL（`0xC0000135`）。
4. **DSH 网络白名单要含 `127.0.0.1`**：否则沙箱内 `adb` / frida 连不上本机回环（`C:\Users\Administrator\.dsh\net-scope-allow.txt`）。

## 组件

| 组件 | 路径/名称 |
|---|---|
| SDK | `E:\android-sdk`（cmdline-tools / emulator 37.3.9 / platform-tools） |
| 系统镜像 | android-30 / google_apis / x86_64（可 root） |
| AVD | `dsh6`，端口 `emulator-5580` |
| frida | `E:\电子取证\10-tools\venv-forensic\Scripts\frida.exe` 17.26.2 |
| frida-server | `E:\android-sdk\frida\frida-server`（x86_64，已推 `/data/local/tmp`） |

## 典型 APK 流程

```powershell
adb -s emulator-5580 install -r .\检材-01.apk
frida -U -f <包名> -l hook.js --no-pause
# 或 dump dex：frida -U -f <包名> -l dump_dex.js
```

## 备注

- 改网卡会让 VMware 虚拟机短暂断网；用完 `stop-emulator.ps1` 恢复。
- 火眼门户（account.forensix.cn）账号有授权到 2026-12-02；主安装包在阿里云盘/百度网盘，需云盘登录才能下；直链组件可用 `update.forensix.cn/api/software/<产品>/component/<id>?fast=true`。
