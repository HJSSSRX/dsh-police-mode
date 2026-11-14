// board.mjs v2 — 实时答题看板：题目表(带微缩跳转+未读红点) + 案件网络
// 用法：node board.mjs --auto [--port 8766] | node board.mjs --run <run-id> [--questions f.jsonl]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.DSH_POLICE_WORKSPACE || process.cwd();
const RUNS = path.join(ROOT, '40-work', 'runs');
const QDIR = path.join(ROOT, '40-work', 'questions');
const args = process.argv.slice(2);
function opt(name, def) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; }
const AUTO = args.includes('--auto');
let fixedRun = opt('run');
if (!AUTO && !fixedRun) { console.error('缺少 --run <run-id> 或 --auto'); process.exit(2); }
const port = parseInt(opt('port', '8766'), 10);
const qExplicit = opt('questions', null);

function readLines(p) { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { return []; } }
function newestRun() {
  try {
    const dirs = fs.readdirSync(RUNS, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_'))
      .map(d => ({ name: d.name, mtime: fs.statSync(path.join(RUNS, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return dirs.length ? dirs[0].name : null;
  } catch { return null; }
}
function questionsFor(run) {
  if (qExplicit && fs.existsSync(qExplicit)) return qExplicit;
  let files = [];
  try { files = fs.readdirSync(QDIR).filter(f => f.endsWith('.jsonl')); } catch {}
  let best = null;
  for (const f of files) {
    const stem = f.replace(/\.jsonl$/, '');
    if (run && run.startsWith(stem) && (!best || stem.length > best.length)) best = stem;
  }
  if (best) return path.join(QDIR, best + '.jsonl');
  let latest = null, lm = 0;
  for (const f of files) { const st = fs.statSync(path.join(QDIR, f)); if (st.mtimeMs > lm) { lm = st.mtimeMs; latest = f; } }
  return latest ? path.join(QDIR, latest) : null;
}
function loadData(run) {
  const qf = questionsFor(run);
  const qs = qf ? readLines(qf).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const runDir = run ? path.join(RUNS, run) : null;
  const ansRows = runDir ? readLines(path.join(runDir, 'answers.jsonl')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const amap = new Map();
  for (const r of ansRows) amap.set(r.qid, r);
  if (runDir && amap.size === 0) {
    for (const line of readLines(path.join(runDir, 'answers.txt'))) {
      const p = line.split('\t');
      if (p.length >= 2) amap.set(p[0].trim(), { qid: p[0].trim(), value: p[1].trim(), status: '已定', source: p[2] || '', loc: p[3] || '', at: '' });
    }
  }
  let submitted = {};
  if (runDir) { try { submitted = JSON.parse(fs.readFileSync(path.join(runDir, 'board-submitted.json'), 'utf8')); } catch {} }
  const answered = qs.filter(q => { const a = amap.get(q.qid); return a && String(a.value || '').trim() !== ''; }).length;
  const cand = qs.filter(q => amap.get(q.qid)?.status === '候选').length;
  const score = qs.reduce((s, q) => s + (amap.get(q.qid) && amap.get(q.qid).status !== '候选' && String(amap.get(q.qid).value || '').trim() !== '' ? (q.score || 0) : 0), 0);
  const submittedCount = Object.values(submitted).filter(Boolean).length;
  const events = [];
  let files = [];
  const evDir = run ? path.join(ROOT, '60-casenets', run, 'tree', 'events') : null;
  if (evDir) { try { files = fs.readdirSync(evDir).filter(f => f.endsWith('.jsonl')); } catch {} }
  for (const f of files) { const by = f.replace('.jsonl', ''); for (const line of readLines(path.join(evDir, f))) { try { const e = JSON.parse(line); e._by = by; events.push(e); } catch {} } }
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const qlinks = new Map(), anchors = [], tasks = [], verdicts = [];
  for (const e of events) {
    if (e.t === 'qlink' && e.qid) { if (!qlinks.has(e.qid)) qlinks.set(e.qid, new Set()); qlinks.get(e.qid).add(e.path); }
    if (e.t === 'anchor' && e.path) anchors.push({ at: e.at, by: e.by || e._by, path: e.path, text: (e.text || '').slice(0, 90) });
    if (e.t === 'task') tasks.push({ at: e.at, by: e.by || e._by, path: e.path, text: (e.text || '').slice(0, 90) });
    if (e.t === 'verdict') verdicts.push({ at: e.at, by: e.by || e._by, path: e.path, text: (e.text || '').slice(0, 90) });
  }
  return {
    run: run || '(等待 run…)', updatedAt: new Date().toISOString(), auto: AUTO,
    stats: { total: qs.length, answered, candidate: cand, missing: qs.length - answered, score, submitted: submittedCount },
    questions: qs, answers: Object.fromEntries(amap.entries()), submitted,
    events: events.slice(-150).map(e => ({ at: e.at, t: e.t, by: e.by || e._by, path: e.path, qid: e.qid, text: (e.text || e.note || '').slice(0, 110) })),
    anchors: anchors.slice(-60), tasks: tasks.slice(-60), verdicts: verdicts.slice(-30),
    qlinks: Object.fromEntries([...qlinks.entries()].map(([k, v]) => [k, [...v]])),
    nodeCount: new Set(events.filter(e => e.path).map(e => e.path)).size,
    eventFileCount: files.length,
  };
}

const HTML = String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>实时答题看板</title>
<style>
*{box-sizing:border-box}
body{margin:0;font:13px/1.5 "Microsoft YaHei",sans-serif;background:#0f1115;color:#e6e6e6}
header{padding:8px 14px;background:#181b22;border-bottom:1px solid #2a2f3a;display:flex;gap:14px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:6}
h1{font-size:14px;margin:0;color:#7cc4ff;white-space:nowrap}
.stat{font-size:12px;color:#aaa}.stat b{color:#fff;font-size:14px;margin-left:3px}
.tabs{display:flex;gap:6px;padding:6px 14px;background:#14171d;position:sticky;top:47px;z-index:5}
.tab{padding:4px 12px;border-radius:6px;cursor:pointer;background:#1d222b;color:#ccc;font-size:12px}
.tab.active{background:#2d6cdf;color:#fff}
#navwrap{padding:6px 14px;background:#12151b;border-bottom:1px solid #232833;position:sticky;top:84px;z-index:4;max-height:92px;overflow:auto}
#nav{display:flex;flex-wrap:wrap;gap:3px}
.navbtn{position:relative;width:30px;height:22px;border:1px solid #2a2f3a;border-radius:4px;background:#1a1f28;color:#9fb3c8;font-size:10px;cursor:pointer;padding:0}
.navbtn.done{background:#1f4d2e;color:#9fe8b8;border-color:#2f6b42}
.navbtn.cand{background:#4d3d1f;color:#f0d79a;border-color:#7a5f22}
.navbtn.sub{outline:1px solid #2d6cdf}
.navbtn.cur{box-shadow:0 0 0 2px #e8c97f}
.navbtn .dot{position:absolute;right:-3px;top:-3px;width:7px;height:7px;border-radius:50%;background:#ff4d4f;border:1px solid #0f1115}
main{padding:8px 14px}
table{width:100%;border-collapse:collapse}
th,td{padding:5px 8px;border-bottom:1px solid #232833;text-align:left;vertical-align:top}
th{position:sticky;top:144px;background:#181b22;color:#9fb3c8;font-weight:500;z-index:3}
tr:hover td{background:#1a1f28}
tr.recent td{background:#17301f}
tr.unread td:first-child{border-left:3px solid #ff4d4f}
.badge{padding:0 7px;border-radius:10px;font-size:11px;white-space:nowrap}
.b-done{background:#1f4d2e;color:#7fe0a0}.b-cand{background:#4d3d1f;color:#e8c97f}.b-miss{background:#3a2020;color:#e08080}.b-empty{background:#2a2a33;color:#9aa}
.ans{color:#7fe0a0;cursor:pointer;font-weight:600;max-width:260px;word-break:break-all}
.q{max-width:480px;color:#cfd8e3}
.src{color:#8a96a6;font-size:12px;max-width:230px;word-break:break-all}
.filters{display:flex;gap:8px;margin-bottom:6px;align-items:center;flex-wrap:wrap}
.filters input{background:#1d222b;border:1px solid #2a2f3a;color:#eee;padding:4px 9px;border-radius:6px;width:240px}
.filters button{background:#1d222b;border:1px solid #2a2f3a;color:#ccc;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px}
.filters button.on{background:#2d6cdf;color:#fff}
.mini{background:#1d222b;border:1px solid #2a2f3a;color:#9fb3c8;border-radius:4px;font-size:11px;padding:1px 5px;cursor:pointer;margin-left:3px}
.net{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{background:#161a21;border:1px solid #232833;border-radius:8px;padding:10px}
.card h3{margin:0 0 6px;font-size:13px;color:#9fb3c8}
.ev{font-size:12px;color:#b9c4d0;border-bottom:1px dashed #232833;padding:3px 0}
.qid{color:#e8c97f}
footer{padding:8px 14px;color:#667;font-size:11px}
</style></head><body>
<header><h1>实时答题看板</h1>
<span class="stat">run<b id="run">-</b></span><span class="stat">题<b id="total">-</b></span>
<span class="stat">已答<b id="answered">-</b></span><span class="stat">候选<b id="cand">-</b></span>
<span class="stat">空<b id="miss">-</b></span><span class="stat">已提交<b id="sub">-</b></span>
<span class="stat">得分估<b id="score">-</b></span><span class="stat">未读<b id="unread">-</b></span>
<span class="stat">更新<b id="upd">-</b></span></header>
<div class="tabs"><div class="tab active" data-tab="q">题目表</div><div class="tab" data-tab="net">案件网络</div></div>
<div id="navwrap"><div id="nav"></div></div>
<main>
<div id="qview">
<div class="filters"><input id="search" placeholder="搜索题号/题干/答案">
<button data-f="all" class="on">全部</button><button data-f="unread">未读更新</button><button data-f="miss">空/未答</button><button data-f="done">已答</button><button data-f="cand">候选</button><button data-f="todo">已答未提交</button>
<button id="markall">全部标已读</button>
<span style="color:#667;font-size:11px">点题号/小题格跳转；点答案复制；红点=有新更新未看</span></div>
<table><thead><tr><th>题号</th><th>题</th><th>状态</th><th>答案</th><th>来源/定位</th><th>提交</th></tr></thead><tbody id="rows"></tbody></table>
</div>
<div id="netview" style="display:none">
<div class="net">
<div class="card"><h3>最近活动（<span id="evcnt">0</span>）</h3><div id="events" style="max-height:420px;overflow:auto"></div></div>
<div class="card"><h3>题号 → 节点（<span id="qlcnt">0</span>）</h3><div id="qlinks" style="max-height:420px;overflow:auto"></div>
<h3 style="margin-top:10px">锚点（最近）</h3><div id="anchors" style="max-height:160px;overflow:auto"></div></div>
</div></div>
</main>
<footer>数据源 answers.jsonl / answers.txt + 60-casenets 事件；自动跟随最新 run；2 秒刷新；勾选提交保存到 run 目录；未读红点存本地。</footer>
<script>
let DATA=null, filter='all', search='';
let seen={}; try{seen=JSON.parse(localStorage.getItem('boardSeen')||'{}')}catch(e){seen={}}
function saveSeen(){try{localStorage.setItem('boardSeen',JSON.stringify(seen))}catch(e){}}
function isUnread(qid){const a=DATA&&DATA.answers[qid];if(!a||!a.at)return false;const t=Date.parse(a.at);const s=seen[qid]||0;return t>s;}
function markSeen(qid){const a=DATA&&DATA.answers[qid];if(a&&a.at)seen[qid]=Date.parse(a.at);saveSeen();}
function tab(name){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));const net=name==='net';document.getElementById('qview').style.display=net?'none':'block';document.getElementById('netview').style.display=net?'block':'none';}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>tab(t.dataset.tab));
document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('on'));b.classList.add('on');filter=b.dataset.f;render();});
document.getElementById('search').oninput=e=>{search=e.target.value.toLowerCase();render();};
document.getElementById('markall').onclick=()=>{if(!DATA)return;DATA.questions.forEach(q=>markSeen(q.qid));render();};
function badge(a){if(!a)return '<span class="badge b-miss">未答</span>';if(!String(a.value||'').trim())return '<span class="badge b-empty">空值</span>';return a.status==='候选'?'<span class="badge b-cand">候选</span>':'<span class="badge b-done">已定</span>';}
function copy(t){if(t)navigator.clipboard.writeText(t);}
function render(){
 if(!DATA)return;
 const now=Date.now();
 const list=DATA.questions.filter(q=>{const a=DATA.answers[q.qid];const empty=!a||!String(a.value||'').trim();
  if(filter==='miss'&&!empty)return false;if(filter==='done'&&empty)return false;if(filter==='cand'&&(!a||a.status!=='候选'))return false;
  if(filter==='todo'&&(empty||DATA.submitted[q.qid]))return false;if(filter==='unread'&&!isUnread(q.qid))return false;
  if(search){const t=(q.qid+' '+q.question+' '+(a?a.value:'')).toLowerCase();if(!t.includes(search))return false;}return true;});
 document.getElementById('rows').innerHTML=list.map(q=>{const a=DATA.answers[q.qid];const recent=a&&a.at&&(now-Date.parse(a.at)<120000);const unread=isUnread(q.qid);const empty=!a||!String(a.value||'').trim();
  return '<tr id="row-'+q.qid+'" class="'+(recent?'recent ':'')+(unread?'unread':'')+'">'
  +'<td><b><a href="#row-'+q.qid+'" style="color:#e8c97f;text-decoration:none" data-qid="'+q.qid+'">'+q.qid+'</a></b></td>'
  +'<td class="q">'+q.question.slice(0,200)+(q.question.length>200?'…':'')+'</td>'
  +'<td>'+badge(a)+'</td>'
  +'<td class="ans" data-v="'+((a&&a.value)||'').replace(/"/g,'&quot;')+'" title="点击复制">'+((a&&a.value)||'')+'</td>'
  +'<td class="src">'+((a&&(a.source||''))||'')+((a&&a.loc)?' | '+a.loc:'')+'<button class="mini" data-copy="'+((a&&a.value)||'').replace(/"/g,'&quot;')+'\\t'+((a&&(a.source||''))||'').replace(/"/g,'&quot;')+'\\t'+((a&&a.loc)||'').replace(/"/g,'&quot;')+'">复制三元组</button></td>'
  +'<td><input type="checkbox" data-qid="'+q.qid+'" '+(DATA.submitted[q.qid]?'checked':'')+'></td></tr>';
 }).join('');
 document.querySelectorAll('a[data-qid]').forEach(a=>a.onclick=()=>{markSeen(a.dataset.qid);});
 document.querySelectorAll('.ans').forEach(td=>td.onclick=()=>copy(td.dataset.v));
 document.querySelectorAll('.mini').forEach(b=>b.onclick=()=>copy(b.dataset.copy));
 document.querySelectorAll('input[data-qid]').forEach(cb=>cb.onchange=async()=>{try{await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({qid:cb.dataset.qid,submitted:cb.checked})});DATA.submitted[cb.dataset.qid]=cb.checked;}catch(e){}});
 // 微缩导航
 const nh=DATA.questions.map(q=>{const a=DATA.answers[q.qid];const empty=!a||!String(a.value||'').trim();const cls=empty?'':(a.status==='候选'?'cand':'done');const sub=DATA.submitted[q.qid]?' sub':'';const dot=isUnread(q.qid)?'<span class="dot"></span>':'';
   return '<button class="navbtn '+cls+sub+'" data-jump="'+q.qid+'" title="'+q.qid+'">'+q.qid.slice(1)+dot+'</button>';}).join('');
 document.getElementById('nav').innerHTML=nh;
 document.querySelectorAll('.navbtn').forEach(b=>b.onclick=()=>{const qid=b.dataset.jump;markSeen(qid);render();
   const row=document.getElementById('row-'+qid);if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.style.outline='2px solid #e8c97f';setTimeout(()=>row.style.outline='',1200);}});
 document.getElementById('unread').textContent=DATA.questions.filter(q=>isUnread(q.qid)).length;
}
async function tick(){
 try{const r=await fetch('/data');DATA=await r.json();}catch(e){return;}
 document.getElementById('run').textContent=DATA.run;
 document.getElementById('total').textContent=DATA.stats.total;
 document.getElementById('answered').textContent=DATA.stats.answered;
 document.getElementById('cand').textContent=DATA.stats.candidate;
 document.getElementById('miss').textContent=DATA.stats.missing;
 document.getElementById('sub').textContent=DATA.stats.submitted;
 document.getElementById('score').textContent=DATA.stats.score;
 document.getElementById('upd').textContent=new Date(DATA.updatedAt).toLocaleTimeString();
 render();
 document.getElementById('evcnt').textContent=DATA.events.length;
 document.getElementById('qlcnt').textContent=Object.keys(DATA.qlinks).length;
 document.getElementById('events').innerHTML=DATA.events.slice().reverse().map(e=>'<div class="ev"><b>'+(e.by||'?')+'</b> <span class="qid">'+e.t+'</span> '+(e.qid||'')+' '+((e.path||'')+' '+(e.text||'')).slice(0,100)+'</div>').join('')||'<div class="ev">暂无事件（案件网络尚未写入）</div>';
 document.getElementById('qlinks').innerHTML=Object.entries(DATA.qlinks).slice(-120).map(([q,ps])=>'<div class="ev"><span class="qid">'+q+'</span> → '+ps.join(', ').slice(0,120)+'</div>').join('')||'<div class="ev">暂无题号→节点绑定</div>';
 document.getElementById('anchors').innerHTML=DATA.anchors.slice().reverse().map(a=>'<div class="ev"><b>'+(a.by||'?')+'</b> '+((a.path||'')+' '+(a.text||'')).slice(0,105)+'</div>').join('')||'<div class="ev">暂无锚点</div>';
}
tick();setInterval(tick,2000);
</script></body></html>`;

function readBody(req) { return new Promise(resolve => { let s = ''; req.on('data', c => s += c); req.on('end', () => resolve(s)); }); }
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/data') {
      const run = AUTO ? (newestRun() || fixedRun) : fixedRun;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(loadData(run)));
      return;
    }
    if (req.url === '/submit' && req.method === 'POST') {
      const run = AUTO ? (newestRun() || fixedRun) : fixedRun;
      const body = JSON.parse(await readBody(req));
      if (!run || !body.qid) { res.writeHead(400); res.end('bad'); return; }
      const f = path.join(RUNS, run, 'board-submitted.json');
      let m = {}; try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      m[body.qid] = !!body.submitted;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(m, null, 1), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
server.listen(port, '127.0.0.1', () => { console.log(`看板 v2: http://127.0.0.1:${port}/  ${AUTO ? '自动跟随最新 run' : 'run=' + fixedRun}`); });
