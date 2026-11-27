// «خريطة الأخطاء الحرارية»: which kind of mistake, in which exercise, and how much of the class hit it.
// Counts are per trainee (one trainee = one count, however many times they hit it). No names are shown.
import { esc } from "./lib.js";

const KINDS = [
  ["unclosed", /Tag <\w+> is not closed/, "وسم مفتوح لم يُغلق"],
  ["unknown", /Unknown tag/, "اسم وسم غير صحيح"],
  ["dup", /Duplicate </, "تكرار وسم من هيكل الصفحة"],
  ["stray", /Closing tag <\/\w+> has no opening/, "وسم إغلاق بلا وسم فتح"],
  ["null", /Cannot (read|set) propert(y|ies) of (null|undefined)/, "استدعاء عنصر غير موجود في الصفحة"],
  ["notdef", /is not defined/, "اسم غير معرّف (إملاء أو حالة الأحرف)"],
  ["notfn", /is not a function/, "استدعاء شيء ليس دالة"],
  ["const", /Assignment to constant/, "تغيير قيمة متغيّر const"],
  ["loop", /Infinite loop/, "حلقة لا تتوقف"],
  ["syntax", /SyntaxError|Unexpected|Invalid or unexpected|missing \)|Unterminated|expected/i, "خطأ في الصياغة: قوس أو علامة ناقصة"],
];
export function errKind(msg) {
  for (const [key, re, label] of KINDS) if (re.test(msg)) return { key, label };
  return { key: "other", label: "أخطاء أخرى" };
}

// tasks: [{ id, title }] in display order · errs: [{ task_id, user_id, message }] · n: trainees in the class
// o.subs: [{ task_id, user_id }] submitted solutions · o.key: show the colour legend (default yes)
function heatData(tasks, errs, n, o = {}) {
  const N = Math.max(n || 0, 1), tset = new Set(tasks.map((t) => t.id)), cell = new Map(), kinds = new Map(), erred = new Set();
  const add = (id, u) => { if (!cell.has(id)) cell.set(id, new Set()); cell.get(id).add(u); };
  for (const e of errs || []) {
    if (!tset.has(e.task_id)) continue;
    const k = errKind(e.message); kinds.set(k.key, k.label); erred.add(e.user_id);
    add(k.key + "|" + e.task_id, e.user_id);
  }
  // three numbers that add up to the class: handed in with no mistake, made a mistake, not handed in yet
  const sent = new Set((o.subs || []).filter((x) => tset.has(x.task_id)).map((x) => x.user_id));
  const hadErr = erred.size, noErr = [...sent].filter((u) => !erred.has(u)).length;
  const notYet = Math.max((n || 0) - hadErr - noErr, 0);
  const cols = tasks.map((t) => ({ id: t.id, title: t.title }));
  const cnt = (k, c) => cell.get(k + "|" + c)?.size || 0;
  const pct = (c) => Math.min(100, Math.round((c / N) * 100));
  const rows = [...kinds].map(([k, label]) => ({ k, label, max: Math.max(...cols.map((c) => cnt(k, c.id))) })).filter((r) => r.max).sort((a, b) => b.max - a.max);
  let worst = { c: 0 };
  for (const r of rows) for (const c of cols) { const v = cnt(r.k, c.id); if (v > worst.c) worst = { c: v, r, col: c }; }
  // traffic light: green = few, yellow = 20% of the class, red = 40% (and at least 2 trainees) → stop and explain
  const level = (c) => (!c ? 0 : c >= 2 && pct(c) >= 40 ? 3 : pct(c) >= 20 ? 2 : 1);
  return { n, sent, hadErr, noErr, notYet, cols, rows, cnt, pct, worst, level, top: level(worst.c) };
}

const noErrText = (d) => `لا توجد أخطاء بعد${d.sent.size ? ` · سلّم ${d.sent.size} من ${d.n}` : " · لم يسلّم أحد بعد"}`;

// one short line for a folded lecture: the worst mistake, or that there are none
export function heatSummary(tasks, errs, n, o = {}) {
  if (!tasks.length) return { level: 0, empty: true, text: "لا توجد تمارين بعد" };
  const d = heatData(tasks, errs, n, o);
  if (!d.rows.length) return { level: 0, empty: true, text: noErrText(d) };
  return { level: d.top, text: `أكثر خطأ: ${d.worst.r.label} · ${d.worst.c} من ${d.n}${d.top === 3 ? " · يُنصح بالتوقف والشرح" : ""}` };
}

export function heatmap(tasks, errs, n, o = {}) {
  if (!tasks.length) return `<p class="small muted">لا توجد تمارين بعد. تظهر الخريطة عندما يحل المتدربون التمارين.</p>`;
  const d = heatData(tasks, errs, n, o);
  if (!d.rows.length) return `<p class="heatnone">${noErrText(d)}</p>`;
  const { worst, pct, level, cnt, cols } = d;
  const banner = d.top === 3
    ? `<div class="heatalert" role="alert"><span><b>${worst.c} من ${n} (${pct(worst.c)}%)</b> وقعوا في خطأ: ${esc(worst.r.label)} في «${esc(worst.col.title)}». يُنصح بالتوقف وشرحه للجميع.</span></div>`
    : "";
  // numbers in plain text colour, only the count lightly tinted; strong red stays for the alert and the red cells
  const stats = `<div class="heatstats three">
    <div class="good"><span>سلّموا بلا خطأ</span><b><i>${d.noErr}</i> من ${n}</b></div>
    <div class="bad"><span>وقعوا في خطأ</span><b><i>${d.hadErr}</i> من ${n}</b></div>
    <div><span>لم يسلّموا بعد</span><b><i>${d.notYet}</i> من ${n}</b></div></div>`;
  const td = (c) => !c ? `<td><span class="hc zero" aria-label="لا أحد"></span></td>`
    : `<td><span class="hc h${level(c)}" title="${c} من ${n}"><b>${pct(c)}%</b><small>${c} من ${n}</small></span></td>`;
  const key = o.key === false ? "" : `<p class="heatkey"><span><i class="hc h1"></i>أقل من 20%</span><span><i class="hc h2"></i>من 20%: انتبه</span><span><i class="hc h3"></i>من 40%: توقف واشرح</span></p>`;
  return `${banner}${stats}<div class="scroll-x"><table class="heat"><thead><tr><th class="corner"><span class="c1">التمارين ←</span><span class="c2">الأخطاء ↓</span></th>${cols.map((c) => `<th>${esc(c.title)}</th>`).join("")}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr><td class="kind">${esc(r.label)}</td>${cols.map((c) => td(cnt(r.k, c.id))).join("")}</tr>`).join("")}</tbody></table></div>${key}`;
}
