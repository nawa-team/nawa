// Editor + live preview + Arabic error help + hand-typed share. Used for tasks and the free lecture editor.
import { $, esc, ai } from "./lib.js";

// Arabic explanations for the most common beginner errors (no AI call needed for these)
const HINTS = [
  [/(\w+) is not defined/, (m) => `المتغيّر أو الدالة «${m[1]}» غير معرَّف. راجِع الاسم حرفًا حرفًا، فقد يكون فيه حرف ناقص أو زائد، أو لم تعرّفه قبل استخدامه.`],
  [/Unexpected end of input/, () => "انتهى الكود قبل أن يكتمل: غالبًا يوجد قوس { أو ( مفتوح لم يُغلق."],
  [/Unexpected token/, () => "يوجد رمز في غير مكانه، مثل قوس زائد أو فاصلة ناقصة. انظر للسطر المذكور وما قبله."],
  [/missing \) after argument list/, () => "قوس ) ناقص بعد قيم الدالة. تأكد أن كل ( لها ) تُغلقها."],
  [/Cannot read propert(y|ies) of (null|undefined)/, () => "تحاول القراءة من عنصر غير موجود. تحقق أن الـ id في HTML يطابق الموجود في JavaScript، وأن السكربت بعد العنصر."],
  [/Cannot set propert(y|ies) of (null|undefined)/, () => "تحاول تغيير عنصر غير موجود في الصفحة. تحقق من تطابق الـ id."],
  [/is not a function/, () => "تستدعي شيئًا كأنه دالة وهو ليس دالة. راجع اسم الدالة وطريقة كتابتها (الحروف الكبيرة والصغيرة مهمة)."],
  [/Assignment to constant variable/, () => "تحاول تغيير قيمة متغيّر معرّف بـ const. استخدم let إذا كانت القيمة تتغيّر."],
  [/Infinite loop/, () => "الحلقة لا تتوقف أبدًا، لذلك أوقفناها حتى لا تتجمّد الصفحة. تأكد أن الشرط يصبح false في وقت ما، مثل زيادة المتغيّر أو إنقاصه داخل الحلقة."],
  [/browser hid the details/, () => "حدث خطأ أثناء التشغيل ولم يُظهر المتصفح تفاصيله. راجِع آخر جزء عدّلته في الكود، وتأكد من الأقواس وعلامات التنصيص وأسماء المتغيّرات."],
  [/Invalid or unexpected token/, () => "يوجد حرف غير مفهوم، غالبًا علامة تنصيص مفتوحة ولم تُغلق."],
];
export function localHint(msg) {
  for (const [re, fn] of HINTS) { const m = msg.match(re); if (m) return fn(m); }
  return null;
}

// Beginners often write loops that never end. Each loop gets a cheap counter check so the page stays alive.
// The check is added on the same line, so error line numbers do not move.
const STOP = 'if(__nl())throw new RangeError("Infinite loop: the loop never stops");';
function protectJs(js) {
  const guarded = js
    .replace(/\b(for|while)\s*\(((?:[^()]|\([^()]*\))*)\)\s*\{/g, (m) => m + STOP)
    .replace(/\bdo\s*\{/g, (m) => m + STOP);
  // try/catch gives the real error object. Safari hides it ("Script error.") when it only reaches window.onerror.
  return "try{" + guarded + "\n}catch(__e){__rep(__e)}";
}
export function protect(code, isJs) {
  return isJs ? protectJs(code) : code.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, b, c) => a + protectJs(b) + c);
}
// Syntax errors stop a script before try/catch can run, so check them here first (nothing is executed).
function syntaxCheck(code, isJs) {
  const blocks = [];
  if (isJs) blocks.push({ js: code, start: 1 });
  else code.replace(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi, (m, a, b, i) => {
    if (!/\bsrc\s*=/i.test(a)) blocks.push({ js: b, start: code.slice(0, i + a.length).split("\n").length });
  });
  for (const b of blocks) {
    try { new Function(b.js); } catch (e) {
      if (!(e instanceof SyntaxError)) continue;
      const l = e.line || e.lineNumber; // Safari / Firefox give a line; the function wrapper adds 2 lines
      return { m: "SyntaxError: " + e.message, line: l ? b.start + Math.max(0, l - 3) : 0 };
    }
  }
  return null;
}

// ---------- syntax colours ----------
const KW = "var|let|const|function|return|if|else|for|while|do|break|continue|new|class|extends|this|true|false|null|undefined|typeof|instanceof|of|in|switch|case|default|try|catch|finally|throw|async|await|import|export|public|private|protected|static|void|int|double|float|char|boolean|String|System|select|from|where|insert|update|delete|into|values|create|table";
const JS = [[/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/, "c"], [/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?/, "s"],
  [/\b\d+(?:\.\d+)?\b/, "n"], [new RegExp("\\b(?:" + KW + ")\\b"), "k"], [/[A-Za-z_$][\w$]*(?=\s*\()/, "f"]];
const CSS = [[/\/\*[\s\S]*?(?:\*\/|$)/, "c"], [/"[^"\n]*"?|'[^'\n]*'?/, "s"], [/[\w-]+(?=\s*:[^:])/, "a"],
  [/#[0-9a-fA-F]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|deg)?/, "n"]];
function paint(src, rules) {
  const re = new RegExp(rules.map((r) => "(" + r[0].source + ")").join("|"), "g");
  let out = "", i = 0;
  for (let m; (m = re.exec(src)); ) {
    if (!m[0]) { re.lastIndex++; continue; }
    const k = m.slice(1).findIndex((x) => x !== undefined);
    out += esc(src.slice(i, m.index)) + `<span class="tk-${rules[k][1]}">${esc(m[0])}</span>`; i = re.lastIndex;
  }
  return out + esc(src.slice(i));
}
const tag = (t) => t.replace(/^(<\/?)([\w-]*)([\s\S]*?)(\/?>)?$/, (m, a, n, rest, z) =>
  `<span class="tk-t">${esc(a + n)}</span>` + paint(rest, [[/"[^"]*"?|'[^']*'?/, "s"], [/[\w:-]+/, "a"]]) + (z ? `<span class="tk-t">${esc(z)}</span>` : ""));
export function highlight(code) {
  if (!/<[a-z!/]/i.test(code)) return paint(code, JS); // plain JavaScript
  const re = /<!--[\s\S]*?(?:-->|$)|(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>|$)|<\/?[A-Za-z][^>]*>?/gi;
  let out = "", i = 0;
  for (let m; (m = re.exec(code)); ) {
    if (!m[0]) { re.lastIndex++; continue; }
    out += esc(code.slice(i, m.index)); i = re.lastIndex;
    if (m[0].startsWith("<!--")) out += `<span class="tk-c">${esc(m[0])}</span>`;
    else if (m[1]) out += tag(m[1]) + paint(m[3], m[2].toLowerCase() === "style" ? CSS : JS) + (m[4] ? tag(m[4]) : "");
    else out += tag(m[0]);
  }
  return out + esc(code.slice(i));
}

const GUARD = `<script>
var __n=0,__s=0;function __nl(){if(++__n>100000){__n=0;return true}if(!__s){__s=1;Promise.resolve().then(function(){__n=0;__s=0})}return false}
function __rep(e){var l=e&&(e.line||e.lineNumber);if(!l&&e&&e.stack){var x=String(e.stack).match(/srcdoc:(\\d+)/);if(x)l=+x[1]}parent.postMessage({nawa:'err',m:e&&e.name?e.name+': '+e.message:String(e),l:l||0},'*')}
window.onerror=function(m,s,l){parent.postMessage({nawa:'err',m:String(m).replace(/^Uncaught /,''),l:l},'*');return true};
(function(){var out=[],pend=0;function show(){var c=document.getElementById('__nawa_console');if(!c){c=document.createElement('pre');c.id='__nawa_console';c.style.cssText='margin:8px 0 0;padding:8px;background:#16181D;color:#BCD13C;border-radius:8px;font:13px/1.5 monospace;white-space:pre-wrap;direction:ltr;text-align:left';(document.body||document.documentElement).appendChild(c)}c.textContent=out.join('\\n')}
var L=console.log;console.log=function(){var a=[].map.call(arguments,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ');if(out.length>=500)return;out.push(a);if(!pend){pend=1;setTimeout(function(){pend=0;show()},0)}L.apply(console,arguments)}})();
window.addEventListener('load',function(){setTimeout(function(){parent.postMessage({nawa:'out',t:(document.body&&document.body.innerText||'').slice(0,3000)},'*')},60)});
<\/script>`;

export function mountWorkspace(root, { code = "", onChange, onError, typed = 0, pasted = 0, big = false } = {}) {
  const st = { typed, pasted, output: "", errors: [] };
  root.innerHTML = `
    <div class="code${big ? " big" : ""}"><div class="gut" aria-hidden="true"></div><div class="codearea"><pre class="hl" aria-hidden="true"></pre><div class="errmark" hidden></div>
    <textarea class="editor" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="محرر الكود">${esc(code)}</textarea></div></div>
    <div class="row"><button class="btn ghost sm" data-w="run">▶ تشغيل</button><span class="grow tiny muted" data-w="typed">الكتابة اليدوية: —</span><span class="chip bad" data-w="paste" hidden>يوجد لصق</span></div>
    <div data-w="err"></div>
    <iframe class="preview" sandbox="allow-scripts allow-modals" title="المعاينة الحية"></iframe>`;
  const ed = $(".editor", root), pv = $(".preview", root), errBox = $('[data-w="err"]', root);
  const hl = $(".hl", root), gut = $(".gut", root), mark = $(".errmark", root);
  let errLine = 0;
  const paintAll = () => {
    hl.innerHTML = highlight(ed.value) + "\n";
    const n = ed.value.split("\n").length;
    gut.innerHTML = Array.from({ length: n }, (_, i) => `<span${i + 1 === errLine ? ' class="e"' : ""}>${i + 1}</span>`).join("");
    ed.style.height = "auto"; ed.style.height = Math.max(ed.scrollHeight, 260) + "px";
    mark.hidden = !errLine || errLine > n; if (!mark.hidden) mark.style.top = `calc(var(--pad) + ${errLine - 1} * var(--lh))`;
  };
  ed.addEventListener("scroll", () => { hl.style.transform = `translateX(${-ed.scrollLeft}px)`; mark.style.transform = hl.style.transform; });
  const goLine = (n) => {
    const lines = ed.value.split("\n"); const pos = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
    ed.focus(); ed.setSelectionRange(pos, pos + (lines[n - 1] || "").length);
    ed.closest(".code").scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
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
  ed.addEventListener("input", () => { paintAll(); upd(); onChange && onChange(ed.value); });
  ed.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText("  ", s, ed.selectionEnd, "end"); st.typed += 2; paintAll(); upd(); }
  });

  const run = () => {
    errBox.innerHTML = ""; st.errors = []; st.output = ""; errLine = 0; paintAll();
    const isJs = !/<[a-z!]/i.test(ed.value); // plain JS without tags runs as a script
    const head = '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:8px">' + GUARD;
    st.offset = head.split("\n").length - 1 + (isJs ? 1 : 0); // so error lines match the editor
    st.syntax = syntaxCheck(ed.value, isJs);
    if (st.syntax) showErr(st.syntax.m, st.syntax.line);
    pv.srcdoc = head + (isJs ? "<script>\n" + protect(ed.value, true) + "\n<\/script>" : protect(ed.value, false)) + "</body>";
  };
  const onMsg = (e) => {
    if (e.source !== pv.contentWindow || !e.data || !e.data.nawa) return;
    if (e.data.nawa === "out") st.output = e.data.t;
    if (e.data.nawa === "err") {
      const msg = e.data.m;
      if (st.syntax && /SyntaxError|^Script error/i.test(msg)) return; // already shown from the syntax check
      showErr(msg, e.data.l ? Math.max(1, e.data.l - (st.offset || 0)) : 0);
    }
  };
  const showErr = (msg, lineNo) => {
      if (/^Script error\.?$/i.test(msg)) msg = "Error: the browser hid the details of this error";
      st.errors.push(msg);
      const lineCode = lineNo ? ed.value.split("\n")[lineNo - 1] || "" : "";
      const local = localHint(msg);
      if (lineNo && !errLine) { errLine = lineNo; paintAll(); }
      errBox.innerHTML = `<div class="err">
        <div class="row"><b class="grow">${lineNo ? `خطأ في السطر ${lineNo}` : "خطأ أثناء التشغيل"}</b>${lineNo ? `<button class="btn plain sm" data-w="goto">اذهب للسطر</button>` : ""}</div>
        ${lineNo ? `<pre class="errsnip" dir="ltr"><span>${lineNo}</span>${highlight(lineCode.trim()) || " "}</pre>` : ""}
        <code dir="ltr">${esc(msg)}</code>
        <span class="small"><b>بالعربية:</b> <span data-w="exp">${local ? esc(local) : "…"}</span></span>
        ${local ? "" : `<button class="btn plain sm" data-w="ask" style="align-self:flex-start">اشرح لي الخطأ</button>`}
        <span class="ai-note">رسالة الخطأ الأصلية تبقى بالإنجليزية لتتعلّم المصطلح. الشرح والتلميح بدون الحل.</span></div>`;
      onError && onError(msg);
      const gt = $('[data-w="goto"]', errBox); if (gt) gt.onclick = () => goLine(lineNo);
      const ask = $('[data-w="ask"]', errBox);
      if (ask) ask.onclick = async () => {
        ask.disabled = true; ask.innerHTML = '<span class="spinner"></span>';
        try { const r = await ai("hint", { message: msg, line_code: lineCode });
          $('[data-w="exp"]', errBox).textContent = r.explain; ask.outerHTML = `<span class="small"><b>تلميح:</b> ${esc(r.hint)}</span><span class="ai-note">شرح من الذكاء الاصطناعي، راجِعه.</span>`;
        } catch (er) { ask.disabled = false; ask.textContent = "اشرح لي الخطأ"; $('[data-w="exp"]', errBox).textContent = er.message; }
      };
  };
  window.addEventListener("message", onMsg);
  paintAll(); upd();
  $('[data-w="run"]', root).onclick = run;
  if (code) run();
  return {
    get code() { return ed.value; },
    set code(v) { ed.value = v; paintAll(); run(); },
    stats: st, run,
    destroy() { window.removeEventListener("message", onMsg); },
    async runAndCollect() { run(); await new Promise((r) => setTimeout(r, 700)); return { output: st.output, errors: st.errors.join("\n") }; },
  };
}
