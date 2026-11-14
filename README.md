# dsh-police-mode（所长模式）

> 给 [DeepSeek Harness](https://github.com/HJSSSRX/dsh-police-mode) 用的取证竞赛协作预设：
> 四层角色（所长/民警/辅警/警械）+ 案件内容网络 + 实时答题看板 + 资源调度脚本。

本项目只包含**方法与工具**，不包含任何比赛题目、答案或检材数据。

## 它解决什么问题

- 多检材、多题量比赛里，一个人做不完 → 所长按检材/题簇派民警，民警派辅警，警械只执行单条命令；
- 多代理并发容易把机器拖死 → 全局并发上限、重工具串行锁、资源仪表自动降档；
- 答案质量参差 → 逐题写入校验（空值拒绝、单选只字母、多选逗号升序、长串禁截断）；
- 你需要实时抢答 → 看板显示每题状态/答案/来源，带微缩跳转与未读红点。

## 目录

```
cordis.patch.yml       DSH bundle patch：注册「所长模式」预设（唯一改动）
scripts/
  cn.mjs               案件内容网络（append-only 事件流，节点/任务/裁决）
  ans.mjs              逐题作答 + 格式校验 + 复核（add/list/check/missing）
  board.mjs            实时答题看板（题目表 + 微缩跳转 + 红点 + 案件网络）
  heavy.ps1            重工具全局串行锁 + BelowNormal 优先级
  sysgauge.ps1         资源仪表（CPU/内存/磁盘队列/重工具锁/建议放行槽位）
  start-board.ps1      后台启动看板（自动跟随最新 run）
docs/
  分级操作指导.md        所长/民警/辅警/警械各自该做什么、复核清单
  playbooks/           方法卡（只含方法，不含答案）
extras/
  prepare-env.ps1      可选：一键拉起本机取证软件（按你的环境修改路径）
install.ps1            把脚本安装到 C:\dsh-forensic\ 并自检
```

## 安装

### 1. 放置脚本

```powershell
git clone https://github.com/HJSSSRX/dsh-police-mode.git
cd dsh-police-mode
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

默认安装到 `C:\dsh-forensic\`（可用 `-Dir` 指定其它目录；若改目录，需同名替换 `cordis.patch.yml` 里的 `C:\dsh-forensic\`）。

### 2. 注册为 DSH 插件

在 DSH 界面：**Plugins → Add plugin → 选择本仓库目录**；
或使用 `plugin_manager` 工具：

```
plugin_manager { "action": "install_bundle", "target": "<本仓库绝对路径>" }
```

安装后**新开一个会话**，模式选择器里会出现 **所长模式**。

## 使用（最短路径）

```powershell
# 1) 开赛先拉起看板（后台常驻）
& C:\dsh-forensic\start-board.ps1            # http://127.0.0.1:8766/

# 2) 资源仪表（每 10 分钟调度用）
& C:\dsh-forensic\sysgauge.ps1 -Json

# 3) 重工具一律排队执行
& C:\dsh-forensic\heavy.ps1 -Name 7z -Cmd "7z x <检材> -o<输出>"

# 4) 逐题作答（格式校验）
node C:\dsh-forensic\ans.mjs add --run <run-id> --qid Q1 --value "答案" --status 已定 --source "路径" --loc "定位" --by M01
node C:\dsh-forensic\ans.mjs check --run <run-id>
```

工作区约定（脚本默认从当前工作目录派生，可用环境变量覆盖）：

| 变量 | 默认 | 用途 |
|---|---|---|
| `DSH_POLICE_WORKSPACE` | `process.cwd()` | 工作区根（下含 `40-work/runs`、`40-work/questions`） |
| `DSH_POLICE_CASENETS` | `<workspace>/60-casenets` | 案件内容网络存储目录 |

## 可选集成

- **火眼套件（Windows）**：`docs/火眼集成.md` 有 CLI 调用方式；`extras/prepare-env.ps1` 是一键启动模板，按你的安装路径修改。
- **WSL 取证工具**：fls/icat/mmls/ewfmount/xfs_db/cryptsetup 等，按需安装。

## 不包含什么

- 任何比赛题目、官方答案、题解、检材数据；
- 第三方受版权/专利保护的代码或文本（仅借鉴公开的方法论，未收录其内容）。

## 许可

MIT。见 `LICENSE`。
