#!/usr/bin/env node
// cn.mjs —— 案件树（Case Network）：以检材目录树为骨架，记录"谁看过什么"
// 存储：60-casenets/<case>/tree/events/<agent>.jsonl（append-only，单写者分片）
//       视图：cn render 合并所有分片 → 单文件 HTML
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.DSH_POLICE_CASENETS || path.join(process.cwd(), '60-casenets')
const args = process.argv.slice(2)
const cmd = args.shift()

function caseDir(name) {
  return path.join(ROOT, name)
}
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }) }
function nowISO() { return new Date().toISOString() }
// 服务器本地时间（给下级引用，避免各层自行换算）
function nowLocal() { return new Date().toLocaleString('sv-SE') }

const COLORS = ['#4C9AFF','#57D9A3','#FFAB00','#FF7452','#8777D9','#00B8D9','#79E2F2','#FF8F73','#FFC400','#B3D4FF','#ABF5D1','#C0B6F2','#F4B400','#36B37E','#6554C0','#00A3BF','#FF5630','#FF991F','#2684FF','#00875A']
function colorOf(agent) {
  let h = 0
  for (const ch of agent) h = (h * 31 + ch.codePointAt(0)) >>> 0
  if (/^M/.test(agent)) return '#FF5630'   // 民警：红
  if (/^Z/.test(agent)) return '#6554C0'   // 所长：紫
  return COLORS[h % COLORS.length]
}
function norm(p) {
  let s = String(p).trim().replace(/\\/g, '/')
  s = s.replace(/^\/+/, '')                 // 去掉 /F:/ 这类前导斜杠
  s = s.replace(/\/{2,}/g, '/')              // 折叠重复斜杠
  s = s.replace(/^([a-zA-Z]):/, (m, d) => d.toUpperCase() + ':') // 盘符大写
  s = s.replace(/\/+$/, '')
  return s
}
// 空/无效路径直接拒绝：少传一个参数不该写出 "undefined" 节点
function requirePath(p, what = '节点路径') {
  const s = String(p ?? '').trim()
  if (!s || /^(-|undefined|null|nan|todo)$/i.test(s)) {
    console.error(`拒绝：${what} 为空或无效（收到 "${p ?? ''}"）`)
    process.exit(2)
  }
  return s
}
function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0 }
function eventsFile(caseName, agent) {
  const dir = path.join(caseDir(caseName), 'tree', 'events')
  ensure(dir)
  return path.join(dir, norm(agent).replace(/[^\w\-.]/g, '_') + '.jsonl')
}
function append(caseName, agent, ev) {
  const line = JSON.stringify({ v: 1, at: nowISO(), ...ev })
  fs.appendFileSync(eventsFile(caseName, agent), line + '\n', 'utf8')
}
function loadEvents(caseName) {
  const dir = path.join(caseDir(caseName), 'tree', 'events')
  if (!fs.existsSync(dir)) return []
  const evs = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue
      try { evs.push(JSON.parse(line)) } catch {}
    }
  }
  evs.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return evs
}

function buildModel(caseName) {
  const evs = loadEvents(caseName)
  const nodes = new Map()   // path -> {path, kind, parent, seen:[], marks:[], verdicts:[], tasks:[], qlinks:[]}
  function node(p, init = {}) {
    p = norm(p)
    if (!nodes.has(p)) nodes.set(p, { path: p, kind: init.kind || 'dir', parent: init.parent || null, marks: [], verdicts: [], tasks: [], qlinks: [], conflicts: 0 })
    return nodes.get(p)
  }
  let taskSeq = 0
  for (const e of evs) {
    if (e.t === 'node') {
      const n = node(e.path, e)
      if (e.parent) n.parent = norm(e.parent)
      if (e.kind) n.kind = e.kind
    } else if (e.t === 'mark') {
      const n = node(e.path); n.marks.push(e)
    } else if (e.t === 'qlink') {
      const n = node(e.path); n.qlinks.push(e)
    } else if (e.t === 'verdict') {
      const n = node(e.path); n.verdicts.push(e)
    } else if (e.t === 'task') {
      const n = node(e.path)
      let id = e.id
      if (!id) { taskSeq++; id = 'T-' + String(taskSeq).padStart(3, '0') }
      else { const num = Number(String(id).replace(/\D/g, '')); if (num > taskSeq) taskSeq = num }
      const prev = n.tasks.find((x) => (x.id || x._id) === id)
      const merged = { ...(prev || {}), ...e, id }
      if (prev) Object.assign(prev, merged)
      else { merged._id = id; n.tasks.push(merged) }
    }
  }
  // 补齐隐式祖先：按路径 dirname 一层层建，保证树形完整
  for (const n of [...nodes.values()]) {
    let cur = n.path
    let parent = path.posix.dirname(cur)
    while (parent && parent !== cur && !nodes.has(parent)) {
      const p = node(parent, { kind: 'dir', parent: path.posix.dirname(parent) })
      p.implicit = true
      cur = parent
      parent = path.posix.dirname(cur)
    }
  }
  // 状态
  for (const n of nodes.values()) {
    n.seen = n.marks.filter((m) => m.seen).length > 0
    n.valuable = n.marks.some((m) => m.valuable) && !n.verdicts.some((v) => v.action === 'refute')
    n.refuted = n.verdicts.some((v) => v.action === 'refute')
    n.agents = [...new Set(n.marks.map((m) => m.by))]
    n.openTasks = n.tasks.filter((t) => t.status !== 'done')
    n.qids = [...new Set(n.qlinks.map((q) => q.qid))]
  }

  return { nodes, evs }
}

function stat(caseName) {
  const { nodes, evs } = buildModel(caseName)
  const all = [...nodes.values()]
  const seen = all.filter((n) => n.seen).length
  const gray = all.length - seen
  const valuable = all.filter((n) => n.valuable).length
  const conflict = all.filter((n) => n.refuted).length
  const agents = new Set(evs.filter((e) => e.by).map((e) => e.by))
  const q = new Set(all.flatMap((n) => n.qids))
  console.log(`案件：${caseName}`)
  console.log(`节点 ${all.length}：已看 ${seen}（${pct(seen, all.length)}%），未看 ${gray}，有价值 ${valuable}`)
  console.log(`贡献者 ${agents.size}：${[...agents].join(', ')}`)
  console.log(`题目绑定 ${q.size} 个；冲突/驳回 ${conflict} 处；待办 ${all.reduce((s, n) => s + n.openTasks.length, 0)}`)
  return { all, seen, gray, valuable, conflict, agents, q }
}

// ---------- 渲染 ----------
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function shortName(p) {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}
function render(caseName, outFile) {
  const { nodes } = buildModel(caseName)
  // 组树
  const byParent = new Map()
  for (const n of nodes.values()) {
    const par = n.parent && nodes.has(n.parent) ? n.parent : null
    if (!byParent.has(par)) byParent.set(par, [])
    byParent.get(par).push(n)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.path.localeCompare(b.path))
  const agents = [...new Set([...nodes.values()].flatMap((n) => n.agents))].sort()

  function nodeHTML(n, depth) {
    const kids = byParent.get(n.path) || []
    const cls = n.refuted ? 'conflict' : n.valuable ? 'valuable' : n.seen ? 'seen' : 'gray'
    const chips = n.agents.map((a) => `<i class="dot" style="background:${colorOf(a)}" title="${esc(a)}"></i>`).join('')
    const q = n.qids.map((x) => `<span class="q">${esc(x)}</span>`).join('')
    const notes = n.marks.filter((m) => m.note).map((m) => `<div class="note" style="border-left-color:${colorOf(m.by)}"><b>${esc(m.by)}</b>${m.valuable ? ' ★有价值' : ' ·无价值'}：${esc(m.note)}${m.loc ? ` <span class="loc">[${esc(m.loc)}]</span>` : ''}</div>`).join('')
    const vs = n.verdicts.map((v) => `<div class="verdict ${esc(v.action)}"><b>${esc(v.by)}</b> ${v.action === 'confirm' ? '确认' : '驳回'}：${esc(v.text || '')}</div>`).join('')
    const ts = n.tasks.map((t) => `<div class="task ${t.status === 'done' ? 'done' : ''}">→ ${esc(t.for || '')}：${esc(t.text || '')}</div>`).join('')
    const body = `${chips}${q}${notes}${vs}${ts}`
    const label = `<span class="nm">${esc(shortName(n.path))}</span><span class="pth">${esc(n.path)}</span>`
    const head = `<summary class="${cls}" data-agents="${esc(n.agents.join(','))}" data-state="${cls}" data-q="${esc(n.qids.join(','))}">${label}<span class="badges">${n.qids.length ? '❓' : ''}${n.openTasks.length ? '⏳' : ''}${n.refuted ? '⚠' : ''}</span></summary>`
    const inner = `<div class="body">${body}</div>` + (kids.length ? `<div class="kids">${kids.map((k) => nodeHTML(k, depth + 1)).join('')}</div>` : '')
    return kids.length ? `<details open data-depth="${depth}">${head}${inner}</details>` : `<details data-depth="${depth}">${head}${inner}</details>`
  }
  const roots = (byParent.get(null) || []).slice().sort((a, b) => a.path.localeCompare(b.path))
  const legend = agents.map((a) => `<span class="lg"><i class="dot" style="background:${colorOf(a)}"></i>${esc(a)}</span>`).join('')
  const s = statQuiet(caseName)
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>案件树 · ${esc(caseName)}</title>
<style>
:root{--bg:#0f1216;--panel:#161b22;--bd:#2a313b;--fg:#e6edf3;--dim:#8b96a5;--yellow:#ffd666;--gray:#5c6673}
@media (prefers-color-scheme:light){:root{--bg:#f6f8fa;--panel:#fff;--bd:#d0d7de;--fg:#1f2328;--dim:#57606a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{padding:14px 18px;border-bottom:1px solid var(--bd);position:sticky;top:0;background:var(--bg);z-index:5}
h1{font-size:16px;margin:0 0 6px}
.stats{color:var(--dim);font-size:12px;margin-bottom:8px}
.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--dim);margin-bottom:8px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:1px}
.filters{display:flex;gap:10px;align-items:center;font-size:12px;flex-wrap:wrap}
.filters input[type=search]{background:var(--panel);border:1px solid var(--bd);color:var(--fg);padding:4px 8px;border-radius:6px;width:220px}
.filters label{color:var(--dim);cursor:pointer}
main{padding:10px 18px 60px}
details{margin:1px 0 1px 14px;border-left:1px dashed var(--bd);padding-left:6px}
details[data-depth="0"]{margin-left:0;border-left:none;padding-left:0}
summary{cursor:pointer;padding:2px 4px;border-radius:4px;list-style:none;display:flex;align-items:center;gap:6px}
summary::-webkit-details-marker{display:none}
summary:hover{background:rgba(127,127,127,.12)}
.nm{font-weight:600}
.pth{color:var(--dim);font-size:11px;display:none}
summary.gray .nm{color:var(--gray);font-weight:400}
summary.seen .nm{color:var(--yellow)}
summary.valuable .nm{color:var(--yellow)}
summary.conflict .nm{color:#ff7b72}
.badges{margin-left:auto;font-size:11px;color:var(--dim)}
.body{padding:2px 8px 4px 22px}
.note{font-size:12px;border-left:3px solid #999;padding:2px 8px;margin:2px 0;color:var(--fg)}
.loc{color:var(--dim);font-size:11px}
.verdict{font-size:12px;margin:2px 0;padding:2px 8px;border-radius:4px}
.verdict.confirm{background:rgba(63,185,80,.12)}
.verdict.refute{background:rgba(248,81,73,.15)}
.task{font-size:12px;color:#d29922}
.task.done{color:var(--dim);text-decoration:line-through}
.q{font-size:11px;background:rgba(88,166,255,.15);color:#58a6ff;border-radius:8px;padding:0 6px;margin-left:4px}
.hide{display:none !important}
</style></head><body>
<header>
  <h1>案件树 · ${esc(caseName)}</h1>
  <div class="stats">节点 ${s.all.length} ｜ 已看 <b>${s.seen}</b>（${pct(s.seen, s.all.length)}%）｜ 未看 <b>${s.gray}</b> ｜ 有价值 ${s.valuable} ｜ 冲突 ${s.conflict} ｜ 题目绑定 ${s.q.size} ｜ 待办 ${s.tasks}</div>
  <div class="legend">${legend || '<span>（无贡献者）</span>'}<span class="lg"><span style="color:var(--yellow)">■</span> 看过</span><span class="lg"><span style="color:var(--gray)">■</span> 未看</span></div>
  <div class="filters">
    <input type="search" id="q" placeholder="搜索路径 / 注记 / 题号">
    <label><input type="checkbox" id="onlySeen"> 只看已看</label>
    <label><input type="checkbox" id="onlyVal"> 只看有价值</label>
    <label><input type="checkbox" id="hideGray"> 隐藏未看</label>
  </div>
</header>
<main id="tree">${roots.map((r) => nodeHTML(r, 0)).join('') || '<p style="color:#888">树上还没有节点，先 cn init + cn see。</p>'}</main>
<script>
const els=[...document.querySelectorAll('summary')];
function apply(){
  const q=document.getElementById('q').value.trim().toLowerCase();
  const onlySeen=document.getElementById('onlySeen').checked;
  const onlyVal=document.getElementById('onlyVal').checked;
  const hideGray=document.getElementById('hideGray').checked;
  const base=new Map();
  els.forEach(sum=>{
    const det=sum.parentElement;
    const txt=(sum.textContent||'').toLowerCase()+' '+(det.querySelector('.body')?.textContent||'').toLowerCase();
    const st=sum.dataset.state;
    let show=true;
    if(q && !txt.includes(q)) show=false;
    if(onlySeen && st==='gray') show=false;
    if(onlyVal && st!=='valuable') show=false;
    if(hideGray && st==='gray') show=false;
    base.set(det, show);
  });
  // 有可见后代则祖先可见
  const visible=new Map(base);
  els.forEach(sum=>{
    const det=sum.parentElement;
    if(!base.get(det)) return;
    let p=det.parentElement?.closest('details');
    while(p){ visible.set(p,true); p=p.parentElement?.closest('details'); }
  });
  els.forEach(sum=>{ const det=sum.parentElement; det.classList.toggle('hide', !visible.get(det)); });
}
['q','onlySeen','onlyVal','hideGray'].forEach(id=>document.getElementById(id).addEventListener('input',apply));
apply();
</script>
</body></html>`
  fs.writeFileSync(outFile, html, 'utf8')
  console.log('已生成：' + outFile)
}
function statQuiet(caseName) {
  const { nodes } = buildModel(caseName)
  const all = [...nodes.values()]
  const seen = all.filter((n) => n.seen).length
  const q = new Set(all.flatMap((n) => n.qids))
  const tasks = all.reduce((s, n) => s + n.openTasks.length, 0)
  return { all, seen, gray: all.length - seen, valuable: all.filter((n) => n.valuable).length, conflict: all.filter((n) => n.refuted).length, q, tasks }
}

// ---------- 机械枚举（确认性基底） ----------
function scanTree(caseName, root, depth, max) {
  const started = nowISO()
  let count = 0
  const out = []
  function walk(p, d) {
    if (count >= max || d < 0) return
    let st = null
    try { st = fs.statSync(p) } catch { return }
    const kind = st.isDirectory() ? 'dir' : 'file'
    const self = norm(p)
    const par = norm(path.dirname(p))
    out.push({ v: 1, at: nowISO(), t: 'node', path: self, kind, parent: par === self ? null : par, size: kind === 'file' ? st.size : null, mtime: st.mtime.toISOString(), by: 'SCAN' })
    count++
    if (kind !== 'dir') return
    let kids = []
    try { kids = fs.readdirSync(p) } catch { return }
    for (const k of kids) walk(path.join(p, k), d - 1)
  }
  walk(root, depth)
  const file = eventsFile(caseName, 'SCAN')
  fs.appendFileSync(file, out.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  append(caseName, 'SCAN', { t: 'scan', root: norm(root), depth, max, count, started, ended: nowISO() })
  console.log(`扫描完成：${count} 个节点（depth=${depth}, max=${max}），写入 ${file}`)
}

// ---------- 锚点（确认性：我在哪、在干什么） ----------
function anchor(caseName, p, by, text, status, ttl) {
  const st = status || 'working'
  // 在岗 ≠ 看过：锚点只记"我在哪"，不再顺手写 seen，否则会绕过"看过必写判断"
  append(caseName, by, { t: 'anchor', path: norm(p), by, text: text || '', status: st, ttlMin: ttl || 15 })
  console.log(`[${nowLocal()}] 锚点：${by} @ ${p} [${st}] ${text || ''}`)
}
function where(caseName) {
  const { evs } = buildModel(caseName)
  const anchors = evs.filter((e) => e.t === 'anchor')
  const latest = new Map()
  for (const a of anchors) latest.set(a.by, a) // 每个 agent 只看最后一条
  const now = Date.now()
  const rows = [...latest.values()].map((a) => {
    const age = Math.round((now - Date.parse(a.at)) / 60000)
    const ttl = a.ttlMin || 15
    return { by: a.by, path: a.path, status: a.status, text: a.text, age, ttl, stale: age > ttl }
  }).sort((x, y) => x.age - y.age)
  console.log('活跃锚点：')
  for (const r of rows) {
    const flag = r.stale ? '⚠ 掉线' : (r.status === 'blocked' ? '⛔ 卡住' : '● 在岗')
    console.log(`  ${flag} ${r.by.padEnd(10)} ${String(r.age).padStart(3)}m前  ${r.path}  ${r.text}`)
  }
  if (!rows.length) console.log('  （无）')
  const stale = rows.filter((r) => r.stale).length
  const blocked = rows.filter((r) => r.status === 'blocked' && !r.stale).length
  const active = rows.filter((r) => !r.stale && r.status !== 'blocked').length
  console.log(`合计 ${rows.length} 个锚点：在岗 ${active}，卡住 ${blocked}，掉线 ${stale}`)
}
// ---------- 看板（P3-1） ----------
function board(caseName) {
  const { nodes } = buildModel(caseName)
  // 按 qid 去重：同一题绑到多个节点只算一次（重复 qlink 不再虚高）
  const qmap = new Map()
  for (const n of [...nodes.values()]) {
    for (const q of n.qids || []) {
      if (!q) continue
      const cur = qmap.get(q) || { family: String(q).split('-')[0], valuable: false }
      if (n.valuable) cur.valuable = true
      qmap.set(q, cur)
    }
  }
  const fam = {}
  for (const v of qmap.values()) {
    const f = (fam[v.family] ||= { total: 0, answered: 0 })
    f.total++
    if (v.valuable) f.answered++
  }
  console.log('分类\t绑定题数(去重)\t已答(有价值)\t已看节点')
  let T = 0, A = 0
  for (const [k, v] of Object.entries(fam)) {
    const seen = [...nodes.values()].filter((n) => (n.qids || []).some((q) => String(q).startsWith(k + '-')) && n.seen).length
    T += v.total; A += v.answered
    console.log(`${k}\t${v.total}\t${v.answered}\t${seen}`)
  }
  console.log(`合计\t${T}\t${A}\t-`)
  console.log(`（去重后绑定 ${qmap.size} 个 qid；重复绑定已合并）`)
  const open = [...nodes.values()].filter((n) => (n.openTasks || []).length)
  console.log(`\n待办 ${open.reduce((s, n) => s + n.openTasks.length, 0)} 条，涉及 ${open.length} 个节点`)
  for (const n of open.slice(0, 8)) console.log(`  ${n.path}  ← ${n.openTasks.map((t) => t.text).join(' / ').slice(0, 80)}`)
}

function insufficient(caseName, p, by, tried, note) {
  const items = String(tried || '').split(/[;；,，]/).map((x) => x.trim()).filter(Boolean)
  if (items.length < 3) {
    console.error(`拒绝：insufficient 必须写至少 3 条已试路径（--tried "a;b;c"），当前 ${items.length} 条`)
    process.exit(2)
  }
  append(caseName, by, { t: 'mark', path: norm(p), by, seen: true, valuable: false, value: 'none', note: `[insufficient] ${note || ''}`, loc: items.join(' | ') })
  console.log(`已记录 insufficient：${by} @ ${p}（${items.length} 条已试路径）`)
}

// ---------- 任务板（借鉴原生 Team 的 claim/complete/依赖） ----------
function taskAdd(caseName, p, by, forWhom, text, after) {
  const np = norm(requirePath(p))
  // 任务号 = 时间戳 + 随机后缀：并发建任务不会再撞号（旧算法是"任务总数+1"）
  const id = 'T-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + Math.random().toString(16).slice(2, 4)
  append(caseName, by, { t: 'task', id, path: np, by, for: forWhom, text, status: 'open', after: after || null })
  console.log(`[${nowLocal()}] 已建任务 ${id} → ${forWhom}：${text}`)
}
function taskList(caseName, opts) {
  const { nodes } = buildModel(caseName)
  const rows = []
  for (const n of nodes.values()) for (const x of n.tasks) rows.push({ ...x, path: n.path })
  const f = rows.filter((r) => (!opts.for || r.for === opts.for) && (!opts.status || r.status === opts.status))
  console.log('ID\t状态\t负责人\t节点\t内容')
  for (const r of f) console.log([r.id || r._id, r.status || 'open', r.for || '-', r.path, (r.text || '').slice(0, 60)].join('\t'))
  const c = {}
  for (const r of rows) c[r.status || 'open'] = (c[r.status || 'open'] || 0) + 1
  console.log('\n合计 ' + rows.length + '：' + JSON.stringify(c))
}
function taskSet(caseName, id, by, status) {
  const { nodes } = buildModel(caseName)
  let found = null
  for (const n of nodes.values()) for (const x of n.tasks) if ((x.id || x._id) === id) found = x
  if (!found) { console.error('任务不存在: ' + id); process.exit(2) }
  append(caseName, by, { t: 'task', id, path: found.path, by, for: found.for, text: found.text, status })
  console.log('任务 ' + id + ' → ' + status)
}
function team(caseName) {
  const { nodes } = buildModel(caseName)
  const agents = new Map()
  for (const n of nodes.values()) {
    for (const m of n.marks) {
      const a = agents.get(m.by) || { marks: 0, valuable: 0, last: '' }
      a.marks++; if (m.valuable) a.valuable++
      if (String(m.at) > a.last) a.last = String(m.at)
      agents.set(m.by, a)
    }
  }
  console.log('Agent\t看过\t有价值\t最近活动')
  for (const [k, a] of [...agents.entries()].sort((x, y) => String(y[1].last).localeCompare(String(x[1].last)))) {
    console.log([k, a.marks, a.valuable, a.last || '-'].join('\t'))
  }
}

// ---------- 命令 ----------
const usage = `用法:
  cn init <case> --root <path>              建树，登记根节点
  cn see <case> <path> --by <agent> [--valuable] [--note 文本] [--loc 定位] [--parent 路径] [--kind dir|file]
  cn qlink <case> <qid> <path> [--role primary|support] --by <agent>
  cn verdict <case> <path> --by <agent> --action confirm|refute --text 文本
  cn task <case> <path> --by <agent> --for <agent> --text 文本 [--done]
  cn task <case> <path> --by <a> --for <b> --text "..." [--after T-001]  建任务
  cn task list <case> [--for b] [--status open]
  cn task claim|done|block <case> <id> --by <a>
  cn team <case>                                    成员看板
  cn board  <case>                                  每族 绑定/已看/已答 + 待办
  cn insufficient <case> <path> --by <agent> --tried "a;b;c" [--note 说明]
  cn scan <case> --root <path> [--depth N] [--max N]   机械枚举目录树（确认性基底）
  cn anchor <case> <path> --by <agent> [--text 说明] [--status working|blocked|done] [--ttl 分钟]
  cn where <case>                                    谁在哪个节点、多久没动
  cn stat <case>
  cn now                                            服务器当前时间（本地 + UTC）
  cn render <case> [--out 文件]`

try {
  if (cmd === 'init') {
    const caseName = args[0]
    const i = args.indexOf('--root')
    const root = i >= 0 ? args[i + 1] : null
    ensure(path.join(caseDir(caseName), 'tree', 'events'))
    if (root) append(caseName, 'M-SYS', { t: 'node', path: root, kind: 'root', parent: null })
    console.log('案件树已初始化：' + caseDir(caseName))
  } else if (cmd === 'see') {
    const [caseName, p] = args
    const g = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
    const by = g('--by') || 'unknown'
    const note = g('--note')
    if (!note || !String(note).trim()) {
      console.error('拒绝：每个看过（黄）的节点必须写一句判断——有价值/无价值 + 说明（--note）')
      process.exit(2)
    }
    const value = args.includes('--valuable') ? 'high' : 'none'
    const np = norm(requirePath(p))
    append(caseName, by, { t: 'node', path: np, parent: g('--parent') ? norm(g('--parent')) : null, kind: g('--kind') || 'file', by })
    append(caseName, by, { t: 'mark', path: np, by, seen: true, valuable: value === 'high', value, note, loc: g('--loc') || '' })
    console.log(`[${nowLocal()}] 已记录：${by} 看过 ${p}（${value === 'high' ? '有价值' : '无价值'}）`)
  } else if (cmd === 'qlink') {
    const [caseName, qid, p] = args
    const g = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
    append(caseName, g('--by') || 'M-SYS', { t: 'qlink', qid, path: norm(requirePath(p)), role: g('--role') || 'primary' })
    console.log(`已绑定：${qid} → ${p}`)
  } else if (cmd === 'verdict') {
    const [caseName, p] = args
    const g = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
    append(caseName, g('--by') || 'M-SYS', { t: 'verdict', path: norm(requirePath(p)), by: g('--by') || 'M-SYS', action: g('--action') || 'confirm', text: g('--text') || '' })
    console.log('已记录裁决')
  } else if (cmd === 'task') {
    const sub = args[0]
    const g = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
    if (sub === 'list') { taskList(args[1], { for: g('--for'), status: g('--status') }); }
    else if (sub === 'claim') { taskSet(args[1], args[2], g('--by') || 'unknown', 'claimed'); }
    else if (sub === 'done') { taskSet(args[1], args[2], g('--by') || 'unknown', 'done'); }
    else if (sub === 'block') { taskSet(args[1], args[2], g('--by') || 'unknown', 'blocked'); }
    else {
      const caseName = args[0], p = args[1]
      taskAdd(caseName, p, g('--by') || 'unknown', g('--for') || '', g('--text') || '', g('--after'))
    }
  } else if (cmd === 'team') {
    team(args[0])
  } else if (cmd === 'board') {
    board(args[0])
  } else if (cmd === 'insufficient') {
    const caseName = args[0], p = args[1]
    const g = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
    insufficient(caseName, requirePath(p), g('--by') || 'unknown', g('--tried'), g('--note'))
  } else if (cmd === 'scan') {
    const caseName = args[0]
    const g = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
    ensure(path.join(caseDir(caseName), 'tree', 'events'))
    const root = g('--root')
    scanTree(caseName, root ? requirePath(root, '--root') : '.', Number(g('--depth') ?? 6), Number(g('--max') ?? 20000))
  } else if (cmd === 'anchor') {
    const caseName = args[0], p = args[1]
    const g = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
    const np = norm(requirePath(p))
    append(caseName, g('--by') || 'unknown', { t: 'node', path: np, kind: 'dir', parent: null })
    anchor(caseName, np, g('--by') || 'unknown', g('--text') || '', g('--status') || 'working', Number(g('--ttl') || 15))
  } else if (cmd === 'where') {
    where(args[0])
  } else if (cmd === 'now') {
    console.log(`本地 ${nowLocal()} | UTC ${nowISO()}`)
  } else if (cmd === 'stat') {
    stat(args[0])
  } else if (cmd === 'render') {
    const caseName = args[0]
    const i = args.indexOf('--out')
    const out = i >= 0 ? args[i + 1] : path.join(caseDir(caseName), 'tree', 'tree.html')
    render(caseName, out)
  } else {
    console.log(usage)
  }
} catch (e) {
  console.error('错误：' + e.message)
  process.exit(1)
}
