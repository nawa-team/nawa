// «خريطة الأخطاء الحرارية»: which kind of mistake, in which exercise, and how much of the class hit it.
// Counts are per trainee (one trainee = one count, however many times they hit it). No names are shown.
import { esc } from "./lib.js";

const KINDS = [
  ["unclosed", /Tag <\w+> is not closed/, "وسم مفتوح لم يُغلق"],
  ["unknown", /Unknown tag/, "اسم وسم غير صحيح"],
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
const people = (n) => (n === 1 ? "متدرب واحد" : n === 2 ? "متدربان" : n <= 10 ? `${n} متدربين` : `${n} متدربًا`);

// tasks: [{ id, title, done? }] in display order · errs: [{ task_id, user_id, message }] · n: trainees in the class
export function heatmap(tasks, errs, n) {
  if (!tasks.length) return `<p class="small muted">لا توجد تمارين بعد. تظهر الخريطة عندما يحل المتدربون التمارين.</p>`;
  const N = Math.max(n || 0, 1), cell = new Map(), kinds = new Map();
  for (const e of errs || []) {
    const k = errKind(e.message); kinds.set(k.key, k.label);
    const id = k.key + "|" + e.task_id; if (!cell.has(id)) cell.set(id, new Set()); cell.get(id).add(e.user_id);
  }
  const cnt = (k, t) => cell.get(k + "|" + t)?.size || 0;
  const pct = (c) => Math.min(100, Math.round((c / N) * 100));
  if (!kinds.size) return `<div class="heatinfo ok">لا توجد أخطاء مسجّلة بعد. تظهر هنا لحظة تشغيل المتدربين لحلولهم.</div>`;
  const rows = [...kinds].map(([k, label]) => ({ k, label, max: Math.max(...tasks.map((t) => cnt(k, t.id))) })).sort((a, b) => b.max - a.max);
  let worst = { c: 0 };
  for (const r of rows) for (const t of tasks) { const c = cnt(r.k, t.id); if (c > worst.c) worst = { c, r, t }; }
  const wp = pct(worst.c);
  const banner = !worst.c ? "" : wp >= 40 && worst.c >= 2
    ? `<div class="heatalert" role="alert"><span><b>${people(worst.c)} من ${n} (${wp}%)</b> وقعوا في خطأ: ${esc(worst.r.label)}، في «${esc(worst.t.title)}». يُنصح بالتوقف وشرحه للجميع.</span></div>`
    : `<div class="heatinfo">أكثر خطأ الآن: ${esc(worst.r.label)} (${wp}%). لا يحتاج توقفًا بعد.</div>`;
  const td = (c) => {
    const p = pct(c);
    if (!c) return `<td><span class="hc zero">–</span></td>`;
    // نَوء colours, four clear steps: soft lime → lime → soft coral → coral
    const lv = p >= 60 ? 4 : p >= 40 ? 3 : p >= 20 ? 2 : 1;
    return `<td><span class="hc h${lv}" title="${people(c)}">${p}%</span></td>`;
  };
  return `${banner}<div class="scroll-x"><table class="heat"><thead><tr><th>نوع الخطأ</th>${tasks.map((t, i) => `<th title="${esc(t.title)}">تمرين ${i + 1}<small>${esc(short(t.title))}</small>${t.done != null ? `<small>سلّم ${t.done} من ${n}</small>` : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="kind">${esc(r.label)}</td>${tasks.map((t) => td(cnt(r.k, t.id))).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="heatkey"><span>أقل من 20%</span><i class="hc h1"></i><i class="hc h2"></i><i class="hc h3"></i><i class="hc h4"></i><span>60% فأكثر</span></div>
    <p class="tiny muted">النسبة = من وقع في الخطأ ÷ عدد متدربي الفصل. كلما غمق اللون زاد من وقعوا في الخطأ، ومن 40% يظهر تنبيه للتوقف والشرح. لا تظهر الأسماء.</p>`;
}
