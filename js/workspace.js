// Editor + live preview + Arabic error help + hand-typed share. Used for tasks and the free lecture editor.
import { $, esc, ai } from "./lib.js";

// Arabic explanations for the most common beginner errors (no AI call needed for these)
const HINTS = [
  [/(\w+) is not defined/, (m) => `المتغيّر أو الدالة «${m[1]}» غير معرَّف. راجِع الاسم حرفًا حرفًا، فقد يكون فيه حرف ناقص أو زائد، أو لم تعرّفه قبل استخدامه.`],
  [/Unexpected end of input/, () => "انتهى الكود قبل أن يكتمل: غالبًا يوجد قوس { أو ( مفتوح لم يُغلق."],
  [/Unexpected token/, () => "يوجد رمز في غير مكانه، مثل قوس زائد أو فاصلة ناقصة. انظر للسطر المذكور وما قبله."],
  [/missing \) after argument list/, () => "قوس ) ناقص بعد قيم الدالة. تأكد أن كل ( لها ) تقفلها."],
  [/Cannot read propert(y|ies) of (null|undefined)/, () => "تحاول القراءة من عنصر غير موجود. تحقق أن الـ id في HTML يطابق الموجود في JavaScript، وأن السكربت بعد العنصر."],
  [/Cannot set propert(y|ies) of (null|undefined)/, () => "تحاول تغيير عنصر غير موجود في الصفحة. تحقق من تطابق الـ id."],
  [/is not a function/, () => "تستدعي شيئًا كأنه دالة وهو ليس دالة. راجع اسم الدالة وطريقة كتابتها (الحروف الكبيرة والصغيرة مهمة)."],
  [/Assignment to constant variable/, () => "تحاول تغيير قيمة متغيّر معرّف بـ const. استخدم let إذا كانت القيمة تتغيّر."],
  [/Infinite loop/, () => "الحلقة لا تتوقف أبدًا، لذلك أوقفناها حتى لا تتجمّد الصفحة. تأكد أن الشرط يصبح false في وقت ما، مثل زيادة المتغيّر أو إنقاصه داخل الحلقة."],
  [/Invalid or unexpected token/, () => "يوجد حرف غير مفهوم، غالبًا علامة تنصيص مفتوحة وما انقفلت."],
];
export function localHint(msg) {
  for (const [re, fn] of HINTS) { const m = msg.match(re); if (m) return fn(m); }
  return null;
}

// Beginners often write loops that never end. Each loop gets a cheap counter check so the page stays alive.
// The check is added on the same line, so error line numbers do not move.
const STOP = 'if(__nl())throw new RangeError("Infinite loop: the loop never stops");';
function protectJs(js) {
  return js
    .replace(/\b(for|while)\s*\(((?:[^()]|\([^()]*\))*)\)\s*\{/g, (m) => m + STOP)
    .replace(/\bdo\s*\{/g, (m) => m + STOP);
}
export function protect(code, isJs) {
  return isJs ? protectJs(code) : code.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, b, c) => a + protectJs(b) + c);
}

const GUARD = `<script>
var __n=0,__s=0;function __nl(){if(++__n>100000){__n=0;return true}if(!__s){__s=1;Promise.resolve().then(function(){__n=0;__s=0})}return false}
window.onerror=function(m,s,l){parent.postMessage({nawa:'err',m:String(m).replace(/^Uncaught /,''),l:l},'*');return true};
(function(){var out=[],pend=0;function show(){var c=document.getElementById('__nawa_console');if(!c){c=document.createElement('pre');c.id='__nawa_console';c.style.cssText='margin:8px 0 0;padding:8px;background:#16181D;color:#BCD13C;border-radius:8px;font:13px/1.5 monospace;white-space:pre-wrap;direction:ltr;text-align:left';(document.body||document.documentElement).appendChild(c)}c.textContent=out.join('\\n')}
var L=console.log;console.log=function(){var a=[].map.call(arguments,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ');if(out.length>=500)return;out.push(a);if(!pend){pend=1;setTimeout(function(){pend=0;show()},0)}L.apply(console,arguments)}})();
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
    const isJs = !/<[a-z!]/i.test(ed.value); // plain JS without tags runs as a script
    const head = '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:8px">' + GUARD;
    st.offset = head.split("\n").length - 1 + (isJs ? 1 : 0); // so error lines match the editor
    pv.srcdoc = head + (isJs ? "<script>\n" + protect(ed.value, true) + "\n<\/script>" : protect(ed.value, false)) + "</body>";
  };
  const onMsg = (e) => {
    if (e.source !== pv.contentWindow || !e.data || !e.data.nawa) return;
    if (e.data.nawa === "out") st.output = e.data.t;
    if (e.data.nawa === "err") {
      const msg = e.data.m, lineNo = Math.max(1, (e.data.l || 1) - (st.offset || 0));
      st.errors.push(msg);
      const lineCode = ed.value.split("\n")[lineNo - 1] || "";
      const local = localHint(msg);
      errBox.innerHTML = `<div class="err"><code>${esc(msg)} (line ${lineNo})</code>
        <span class="small"><b>بالعربي:</b> <span data-w="exp">${local ? esc(local) : "…"}</span></span>
        ${local ? "" : `<button class="btn plain sm" data-w="ask" style="align-self:flex-start">اشرح لي الخطأ</button>`}
        <span class="ai-note">رسالة الخطأ الأصلية تبقى بالإنجليزية لتتعلّم المصطلح. الشرح والتلميح بدون الحل.</span></div>`;
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
