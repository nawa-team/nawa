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

const short = (s) => (s.length > 22 ? s.slice(0, 21) + "…" : s);

// tasks: [{ id, title }] in display order · errs: [{ task_id, user_id, message }] · n: trainees in the class
// o.subs: [{ task_id, user_id }] submitted solutions · o.overall: one column for all the exercises together
export function heatmap(tasks, errs, n, o = {}) {
  if (!tasks.length) return `<p class="small muted">لا توجد تمارين بعد. تظهر الخريطة عندما يحل المتدربون التمارين.</p>`;
  const N = Math.max(n || 0, 1), tset = new Set(tasks.map((t) => t.id)), cell = new Map(), kinds = new Map(), erred = new Set();
  const add = (id, u) => { if (!cell.has(id)) cell.set(id, new Set()); cell.get(id).add(u); };
  for (const e of errs || []) {
    if (!tset.has(e.task_id)) continue;
    const k = errKind(e.message); kinds.set(k.key, k.label); erred.add(e.user_id);
    add(k.key + "|" + e.task_id, e.user_id); add(k.key + "|*", e.user_id);
  }
  // two numbers that add up to the class: who made a mistake, and who did not
  const hadErr = Math.min(erred.size, n || erred.size), noErr = Math.max((n || 0) - hadErr, 0);
  const stats = `<div class="heatstats">
    <div class="bad"><span>وقعوا في خطأ</span><b>${hadErr} من ${n}</b></div>
    <div class="good"><span>بلا أي خطأ</span><b>${noErr} من ${n}</b></div></div>`;
  if (!kinds.size) return `${stats}<div class="heatinfo ok">لا توجد أخطاء مسجّلة بعد. تظهر هنا لحظة تشغيل المتدربين لحلولهم.</div>`;
  const cols = o.overall ? [{ id: "*", head: "كل التمارين" }] : tasks.map((t, i) => ({ id: t.id, head: `تمرين ${i + 1}`, sub: short(t.title), title: t.title }));
  // how many trainees handed in each exercise (one plain row, per lecture only)
  const doneOf = (id) => new Set((o.subs || []).filter((x) => x.task_id === id).map((x) => x.user_id)).size;
  const doneRow = o.overall ? "" : `<tr class="done"><td class="kind">عدد من سلّم</td>${cols.map((c) => `<td><b>${doneOf(c.id)} من ${n}</b></td>`).join("")}</tr>`;
  const cnt = (k, c) => cell.get(k + "|" + c)?.size || 0;
  const pct = (c) => Math.min(100, Math.round((c / N) * 100));
  const rows = [...kinds].map(([k, label]) => ({ k, label, max: Math.max(...cols.map((c) => cnt(k, c.id))) })).filter((r) => r.max).sort((a, b) => b.max - a.max);
  let worst = { c: 0 };
  for (const r of rows) for (const c of cols) { const v = cnt(r.k, c.id); if (v > worst.c) worst = { c: v, r, col: c }; }
  // traffic light: green = few, yellow = 20% of the class, red = 40% (and at least 2 trainees) → stop and explain
  const level = (c) => (!c ? 0 : c >= 2 && pct(c) >= 40 ? 3 : pct(c) >= 20 ? 2 : 1);
  const where = o.overall ? "" : ` في «${esc(worst.col.title)}»`;
  const banner = level(worst.c) === 3
    ? `<div class="heatalert" role="alert"><span><b>${worst.c} من ${n} (${pct(worst.c)}%)</b> وقعوا في خطأ: ${esc(worst.r.label)}${where}. يُنصح بالتوقف وشرحه للجميع.</span></div>`
    : `<div class="heatinfo">أكثر خطأ الآن: ${esc(worst.r.label)}${where}، وقع فيه ${worst.c} من ${n}.</div>`;
  const td = (c) => !c ? `<td><span class="hc zero">0%</span></td>`
    : `<td><span class="hc h${level(c)}" title="${c} من ${n}"><b>${pct(c)}%</b><small>${c} من ${n}</small></span></td>`;
  return `${banner}${stats}<div class="scroll-x"><table class="heat${o.overall ? " one" : ""}"><thead><tr><th>نوع الخطأ</th>${cols.map((c) => `<th${c.title ? ` title="${esc(c.title)}"` : ""}>${c.sub ? esc(c.sub) : c.head}</th>`).join("")}</tr></thead>
    <tbody>${doneRow}${rows.map((r) => `<tr><td class="kind">${esc(r.label)}</td>${cols.map((c) => td(cnt(r.k, c.id))).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="heatkey">كل خانة: كم متدربًا من الفصل وقع في هذا الخطأ، ونسبتهم من الفصل. <span><i class="hc h1"></i>أقل من 20%</span><span><i class="hc h2"></i>من 20%: انتبه</span><span><i class="hc h3"></i>من 40%: توقف واشرح</span></p>`;
}
