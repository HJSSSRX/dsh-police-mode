// ans.mjs — 逐题作答记录（追加写入，供看板/复核读取）
// 用法：
//   node ans.mjs add --run <run-id> --qid Q1 --value "答案" [--status 已定|候选] [--source "路径"] [--loc "定位"] [--by M01] [--questions <jsonl>] [--force]
//   node ans.mjs list --run <run-id>
//   node ans.mjs check --run <run-id> [--questions <jsonl>]   # 校验已写记录格式
// 存储：E:\电子取证\40-work\runs\<run-id>\answers.jsonl（每题一行，追加）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.DSH_POLICE_WORKSPACE || process.cwd();
const args = process.argv.slice(2);
const cmd = args[0];
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const run = opt('run');
if (!run) { console.error('缺少 --run <run-id>'); process.exit(2); }
const runDir = path.join(ROOT, '40-work', 'runs', run);
const ansFile = path.join(runDir, 'answers.jsonl');
const qDir = path.join(ROOT, '40-work', 'questions');

function resolveQuestions() {
  const explicit = opt('questions');
  if (explicit) return explicit;
  // 按 run-id 前缀匹配题单：run=<赛事名>-<时间> → <赛事名>.jsonl
  try {
    const files = fs.readdirSync(qDir).filter(f => f.endsWith('.jsonl'));
    let best = null;
    for (const f of files) {
      const stem = f.replace(/\.jsonl$/, '');
      if (run.startsWith(stem) && (!best || stem.length > best.length)) best = stem;
    }
    return best ? path.join(qDir, best + '.jsonl') : null;
  } catch { return null; }
}
function loadQuestions() {
  const p = resolveQuestions();
  if (!p || !fs.existsSync(p)) return null;
  const m = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
    try { const q = JSON.parse(line); m.set(q.qid, q); } catch {}
  }
  return m;
}
function readAnswers() {
  if (!fs.existsSync(ansFile)) return [];
  return fs.readFileSync(ansFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function latest(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.qid, r);
  return m;
}
// 按题型校验格式，返回问题数组（空=通过）
function checkFormat(q, rec) {
  const issues = [];
  const v = String(rec.value ?? '').trim();
  if (!v) issues.push('value 为空（空值一律拒绝，即使是 insufficient 也必须给候选值）');
  if (/\.\.\.|…/.test(v)) issues.push('值被截断（含省略号），必须写完整值');
  if (q) {
    const t = q.type || '';
    if (t.includes('单选') && !/^[A-Za-z]$/.test(v)) issues.push(`单选应为单个字母，当前「${v}」`);
    if (t.includes('多选') && !/^[A-Za-z](,[A-Za-z])*$/.test(v)) issues.push(`多选应为逗号分隔升序字母（如 B,C,D），当前「${v}」`);
    if (t.includes('判断') && !/^(对|错|正确|错误|true|false)$/i.test(v)) issues.push(`判断应为「对/错」，当前「${v}」`);
  }
  if (rec.status !== '候选') {
    if (!String(rec.source || '').trim()) issues.push('已定缺少来源(--source)');
    if (!String(rec.loc || '').trim()) issues.push('已定缺少定位(--loc)');
  }
  return issues;
}

if (cmd === 'add') {
  const qid = opt('qid');
  const value = opt('value');
  if (!qid || value === undefined) { console.error('缺少 --qid/--value'); process.exit(2); }
  const qs = loadQuestions();
  const q = qs ? qs.get(qid) : null;
  const rec = {
    qid,
    value,
    status: opt('status', '已定'),
    source: opt('source', ''),
    loc: opt('loc', ''),
    by: opt('by', ''),
    at: new Date().toISOString(),
  };
  const issues = checkFormat(q, rec);
  const force = args.includes('--force');
  const fatal = issues.some(i => i.startsWith('value 为空'));
  if ((issues.length && !force) || fatal) {
    console.error('拒绝写入 ' + qid + '：\n - ' + issues.join('\n - ') + '\n（空值不允许 --force；其他格式问题确认无误可加 --force）');
    process.exit(3);
  }
  fs.mkdirSync(runDir, { recursive: true });
  fs.appendFileSync(ansFile, JSON.stringify(rec) + '\n', 'utf8');
  console.log('OK ' + qid + ' = ' + value + (issues.length ? '（格式警告已强制写入）' : ''));
} else if (cmd === 'list') {
  const m = latest(readAnswers());
  for (const [qid, r] of [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    console.log(`${qid}\t${r.value}\t${r.status}\t${r.source}\t${r.by}`);
  }
  console.log(`共 ${m.size} 题有记录`);
} else if (cmd === 'check') {
  const m = latest(readAnswers());
  const qs = loadQuestions();
  let bad = 0;
  for (const [qid, r] of m.entries()) {
    const issues = checkFormat(qs ? qs.get(qid) : null, r);
    if (issues.length) { bad++; console.log(`✗ ${qid}  ${r.value}  ← ${issues.join('；')}`); }
  }
  console.log(`记录 ${m.size} 题，格式问题 ${bad} 题`);
  if (bad) process.exit(4);
} else {
  console.log('用法: node ans.mjs add|list|check --run <run-id> ...');
}
