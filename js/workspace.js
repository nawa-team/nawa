// Editor + live preview + Arabic error help + hand-typed share. Used for tasks and the free lecture editor.
import { $, esc, ai } from "./lib.js";

// Arabic explanations for the most common beginner errors (no AI call needed for these)
const HINTS = [
  [/(\w+) is not defined/, (m) => `المتغيّر أو الدالة «${m[1]}» غير معرَّف. راجِع الاسم حرفًا حرفًا، فقد يكون فيه حرف ناقص أو زائد، أو لم تعرّفه قبل استخدامه.`],
  [/Unexpected end of input/, () => "الكود انتهى قبل ما يكتمل: غالبًا قوس { أو ( مفتوح وما انقفل."],
  [/Unexpected token/, () => "يوجد رمز في غير مكانه، مثل قوس زائد أو فاصلة ناقصة. انظر للسطر المذكور وما قبله."],
  [/missing \) after argument list/, () => "قوس ) ناقص بعد قيم الدالة. تأكد أن كل ( لها ) تقفلها."],
  [/Cannot read propert(y|ies) of (null|undefined)/, () => "تحاول تقرأ من عنصر غير موجود. تحقق أن الـ id في HTML يطابق اللي في JavaScript، وأن السكربت بعد العنصر."],
  [/Cannot set propert(y|ies) of (null|undefined)/, () => "تحاول تغيّر عنصر غير موجود في الصفحة. تحقق من تطابق الـ id."],
  [/is not a function/, () => "تستدعي شيئًا كأنه دالة وهو ليس دالة. راجع اسم الدالة وطريقة كتابتها (الحروف الكبيرة والصغيرة مهمة)."],
  [/Assignment to constant variable/, () => "تحاول تغيّر قيمة متغيّر معرّف بـ const. استخدم let إذا كانت القيمة تتغيّر."],
  [/Invalid or unexpected token/, () => "يوجد حرف غير مفهوم، غالبًا علامة تنصيص مفتوحة وما انقفلت."],
];
export function localHint(msg) {
  for (const [re, fn] of HINTS) { const m = msg.match(re); if (m) return fn(m); }
  return null;
}

const GUARD = `<script>
window.onerror=function(m,s,l){parent.postMessage({nawa:'err',m:String(m).replace(/^Uncaught /,''),l:l},'*');return true};
window.addEventListener('load',function(){setTimeout(function(){parent.postMessage({nawa:'out',t:(document.body&&document.body.innerText||'').slice(0,3000)},'*')},60)});
<\/script>`;

export function mountWorkspace(root, { code = "", onChange, onError, typed = 0, pasted = 0 } = {}) {
  const st = { typed, pasted, output: "", errors: [] };
  root.innerHTML = `
    <textarea class="editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="محرر الكود">${esc(code)}</textarea>
    <div class="row"><button class="btn ghost sm" data-w="run">▶ تشغيل</button><span class="grow tiny muted" data-w="typed">الكتابة اليدوية: —</span><span class="chip bad" data-w="paste" hidden>يوجد لصق</span></div>
    <div data-w="err"></div>
    <iframe class="preview" sandbox="allow-scripts allow-modals" title="المعاينة الحية"></iframe>`;
  const ed = $(".editor", root), pv = $(".preview", root), errBox = $('[data-w="err"]', root);
  const upd = () => {
    const t = st.typed + st.pasted;
    $('[data-w="typed"]', root).textContent = "الكتابة اليدوية: " + (t ? Math.round((st.typed / t) * 100) + "%" : "—");
    $('[data-w="paste"]', root).hidden = !st.pasted;
  };
  ed.addEventListener("beforeinput", (e) => {
    if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") return;
    if (e.inputType.startsWith("insert")) st.typed += (e.data || " ").length;
  });
  ed.addEventListener("paste", (e) => { st.pasted += ((e.clipboardData && e.clipboardData.getData("text")) || "").length; setTimeout(upd); });
  ed.addEventListener("input", () => { upd(); onChange && onChange(ed.value); });
  ed.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText("  ", s, ed.selectionEnd, "end"); st.typed += 2; upd(); }
  });

  const run = () => {
    errBox.innerHTML = ""; st.errors = []; st.output = "";
    pv.srcdoc = '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:8px">' + GUARD + ed.value + "</body>";
  };
  const onMsg = (e) => {
    if (e.source !== pv.contentWindow || !e.data || !e.data.nawa) return;
    if (e.data.nawa === "out") st.output = e.data.t;
    if (e.data.nawa === "err") {
      const msg = e.data.m, lineNo = Math.max(1, (e.data.l || 1) - 1);
      st.errors.push(msg);
      const lineCode = ed.value.split("\n")[lineNo - 1] || "";
      const local = localHint(msg);
      errBox.innerHTML = `<div class="err"><code>${esc(msg)} (line ${lineNo})</code>
        <span class="small"><b>بالعربي:</b> <span data-w="exp">${local ? esc(local) : "…"}</span></span>
        ${local ? "" : `<button class="btn plain sm" data-w="ask" style="align-self:flex-start">اشرح لي الخطأ</button>`}
        <span class="ai-note">رسالة الخطأ الأصلية تبقى بالإنجليزي عشان تتعلّم المصطلح. الشرح والتلميح بدون الحل.</span></div>`;
      onError && onError(msg);
      const ask = $('[data-w="ask"]', errBox);
      if (ask) ask.onclick = async () => {
        ask.disabled = true; ask.innerHTML = '<span class="spinner"></span>';
        try { const r = await ai("hint", { message: msg, line_code: lineCode });
          $('[data-w="exp"]', errBox).textContent = r.explain; ask.outerHTML = `<span class="small"><b>تلميح:</b> ${esc(r.hint)}</span><span class="ai-note">شرح من الذكاء الاصطناعي، راجِعه.</span>`;
        } catch (er) { ask.disabled = false; ask.textContent = "اشرح لي الخطأ"; $('[data-w="exp"]', errBox).textContent = er.message; }
      };
    }
  };
  window.addEventListener("message", onMsg);
  upd();
  $('[data-w="run"]', root).onclick = run;
  if (code) run();
  return {
    get code() { return ed.value; },
    set code(v) { ed.value = v; run(); },
    stats: st, run,
    destroy() { window.removeEventListener("message", onMsg); },
    async runAndCollect() { run(); await new Promise((r) => setTimeout(r, 700)); return { output: st.output, errors: st.errors.join("\n") }; },
  };
}
