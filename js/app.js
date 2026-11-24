import { sb, START_HASH, $, $$, esc, toast, friendly, ai, fmtMin, ago, LOGO, ICON, route, go, render, onLeave } from "./lib.js";
import { mountWorkspace } from "./workspace.js";
import { openPdf, renderPage, extractText } from "./pdf.js";

const app = $("#app");
// light / dark: follows the device until the person picks one
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const themeBtn = (cls = "") => `<button class="themebtn ${cls}" data-theme-btn aria-label="الوضع الفاتح أو الداكن" title="الوضع الفاتح أو الداكن">${isDark() ? "☀️" : "🌙"}</button>`;
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-theme-btn]"); if (!b) return;
  const t = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = t;
  try { localStorage.setItem("nawa.theme", t); } catch (_) {}
  document.querySelectorAll("[data-theme-btn]").forEach((x) => (x.textContent = t === "dark" ? "☀️" : "🌙"));
  const mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.content = t === "dark" ? "#16181D" : "#F6F7F5";
});
let me = null; // { id, email, full_name, role }

async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { me = null; return null; }
  const { data: p } = await sb.from("profiles").select("full_name,role").eq("id", session.user.id).single();
  me = { id: session.user.id, email: session.user.email, ...(p || { full_name: "", role: "trainee" }) };
  return me;
}

// ---------- layout ----------
const NAV = {
  t: [["/t", "الرئيسية", "home"], ["/t/tasks", "المحاضرات", "slides"], ["/t/practice", "التدريب", "bulb"], ["/t/me", "حسابي", "user"]],
  m: [["/m", "فصولي", "class"], ["/m/me", "حسابي", "user"]],
};
function shell(role, active, html, cls = "") {
  const nav = NAV[role];
  app.innerHTML = `
    <header class="top"><a class="brand" href="#${nav[0][0]}">${LOGO}<span>نَوء</span></a><span class="grow"></span>${themeBtn()}
      <nav>${nav.map(([h, l]) => `<a href="#${h}" ${h === active ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav></header>
    <main class="${cls}">${html}</main>
    <nav class="tabs">${nav.map(([h, l, i]) => `<a href="#${h}" ${h === active ? 'aria-current="page"' : ""}>${ICON[i]}${l}</a>`).join("")}</nav>`;
  return $("main", app);
}
const loading = () => (app.innerHTML = `${themeBtn("float")}<main class="narrow"><div class="empty"><span class="spinner"></span></div></main>`);
function need(role) {
  if (!me) { go("/login"); return false; }
  if (role && me.role !== role) { go(me.role === "trainer" ? "/m" : "/t"); return false; }
  return true;
}
// a live session ends by itself if the trainer forgot to end it (no slide change for 3 hours)
const LIVE_MS = 3 * 3600 * 1000;
const fixLive = (c) => { if (c && c.live_slide && !(c.live_at && Date.now() - new Date(c.live_at) < LIVE_MS)) c.live_slide = null; return c; };
const STATUS = { new: ["جديد", "new"], open: ["لم يُسلَّم", ""], done: ["تم التسليم", "ok"] };
const VERDICT = { correct: ["صحيح", "ok"], partial: ["قريب", "new"], wrong: ["يحتاج مراجعة", "bad"] };
const vchip = (v) => (v ? `<span class="chip ${VERDICT[v][1]}">${VERDICT[v][0]}</span>` : "");
const pct = (a, b) => (a + b ? Math.round((a / (a + b)) * 100) : null);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// lecture upload. iPad/iPhone sometimes give a PDF with no type, so the name is checked too.
async function uploadPdf(classId, file) {
  if (!file || !file.size) throw new Error("اختر ملف المحاضرة أولًا");
  if (/\.(pptx?|key|docx?|odp)$/i.test(file.name)) throw new Error("هذا ملف عرض أو مستند. احفظه بصيغة PDF أولًا (ملف ← حفظ باسم أو تصدير ← PDF) ثم ارفعه.");
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) throw new Error("يجب أن يكون الملف بصيغة PDF");
  if (file.size > 15 * 1024 * 1024) throw new Error("الملف أكبر من 15 ميجا. صغّر حجمه ثم ارفعه.");
  const path = `${classId}/${uid()}.pdf`;
  const { error } = await sb.storage.from("lectures").upload(path, file, { contentType: "application/pdf" });
  if (error) throw error;
  return path;
}
// two taps for anything that deletes, so it never happens by mistake
function twoTap(b, label, fn) {
  b.onclick = async (e) => {
    e.preventDefault();
    if (!b.dataset.sure) { b.dataset.sure = 1; b.dataset.old = b.textContent; b.textContent = label; b.classList.add("danger"); setTimeout(() => { if (b.isConnected && b.dataset.sure) { delete b.dataset.sure; b.textContent = b.dataset.old; } }, 5000); return; }
    b.disabled = true; await fn(); b.disabled = false;
  };
}
// «تمرين الشريحة»: the exercise pinned to the slide the trainer just reached pops up for the trainee
async function slideTaskFor(lectureId, slide) {
  if (!lectureId || !slide) return null;
  const { data } = await sb.from("tasks").select("id,title,slide").eq("lecture_id", lectureId).eq("slide", slide).limit(1);
  const t = data?.[0]; if (!t) return null;
  const { data: sub } = await sb.from("submissions").select("submitted_at").eq("task_id", t.id).eq("user_id", me.id).maybeSingle();
  return { ...t, done: !!sub?.submitted_at };
}
function popSlideTask(t) {
  const k = "nawa.pop." + t.id; let shown = false; try { shown = sessionStorage.getItem(k); sessionStorage.setItem(k, 1); } catch (_) {}
  if (shown) return;
  $(".sheet")?.remove(); // the newest slide wins
  const d = document.createElement("div"); d.className = "sheet"; d.role = "dialog";
  d.innerHTML = `<span class="chip live" style="align-self:flex-start"><span class="dot"></span> تمرين الشريحة ${t.slide}</span>
    <b>وصل المدرب لتمرين: ${esc(t.title)}</b><span class="small muted">${t.done ? "سبق تسليم هذا التمرين. افتحه لمراجعة الحل مع الشرح." : "حلّه الآن والفكرة ما زالت في ذهنك."}</span>
    <div class="row"><a class="btn grow" href="#/t/task/${t.id}">${t.done ? "مراجعة الحل" : "ابدأ الحل"}</a><button class="btn plain">لاحقًا</button></div>`;
  document.body.appendChild(d); $("button", d).onclick = () => d.remove(); $("a", d).onclick = () => d.remove();
}
// enlarge a slide to the whole screen
async function zoomSlide(doc, start, onMove) {
  let page = start;
  const d = document.createElement("div"); d.className = "zoom"; d.role = "dialog";
  d.innerHTML = `<div class="row"><b class="grow" id="zpg"></b><button class="btn plain sm" id="zx">إغلاق ✕</button></div>
    <div class="zoombox"><canvas></canvas></div><div class="slidenav"><button class="btn plain" id="zp">› السابقة</button><span class="grow"></span><button class="btn plain" id="zn">التالية ‹</button></div>`;
  document.body.appendChild(d); document.body.style.overflow = "hidden";
  const cv = $("canvas", d);
  const show = async (n) => { page = Math.max(1, Math.min(doc.numPages, n)); $("#zpg", d).textContent = `الشريحة ${page} من ${doc.numPages}`; await renderPage(doc, page, cv, true); onMove && onMove(page); };
  const close = () => { d.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", key); };
  const key = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") show(page + 1); if (e.key === "ArrowRight") show(page - 1); };
  document.addEventListener("keydown", key);
  $("#zx", d).onclick = close; $("#zp", d).onclick = () => show(page - 1); $("#zn", d).onclick = () => show(page + 1);
  await show(page);
}

// ---------- auth ----------
route("/", async () => { await loadMe(); go(!me ? "/welcome" : me.role === "trainer" ? "/m" : "/t"); });

route("/welcome", () => {
  app.innerHTML = `${themeBtn("float")}<main class="narrow">
    <div class="auth-hero">${LOGO}<b>نَوء</b><p class="muted">المحاضرة والكود في شاشة واحدة</p></div>
    <div class="card"><p class="small">شرائح المحاضرة ومحرر الكود والمعاينة الحية في مكان واحد. بدون تنقّل بين النوافذ، وبدون صور شاشة.</p></div>
    <a class="btn" href="#/login">تسجيل الدخول</a><a class="btn plain" href="#/signup">إنشاء حساب</a>
    <div class="card" style="text-align:center"><b>تجربة سريعة بدون تسجيل</b><span class="small muted">ادخل بحساب تجريبي فيه فصل وبيانات وهمية جاهزة.</span>
      <div class="row"><button class="btn ghost grow" data-demo="trainer">كمدرب</button><button class="btn ghost grow" data-demo="trainee">كمتدرب</button></div><p class="tiny muted" id="dmsg"></p></div>
    <p class="tiny muted" style="text-align:center">نسخة تجريبية ببيانات تجريبية. يُستخدم الذكاء الاصطناعي للمساعدة، والقرار للمدرب.</p></main>`;
  $$("[data-demo]").forEach((btn) => (btn.onclick = async () => {
    $$("[data-demo]").forEach((x) => (x.disabled = true)); $("#dmsg").textContent = "جارٍ الدخول…";
    try {
      const { data, error } = await sb.functions.invoke("demo", { body: { role: btn.dataset.demo } });
      if (error || !data?.token_hash) throw error || new Error(data?.error || "تعذّر الدخول");
      const { error: e2 } = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
      if (e2) throw e2;
      await loadMe(); go("/");
    } catch (e) { $("#dmsg").textContent = friendly(e); $$("[data-demo]").forEach((x) => (x.disabled = false)); }
  }));
});

route("/login", () => {
  app.innerHTML = `${themeBtn("float")}<main class="narrow"><div class="auth-hero">${LOGO}<b>نَوء</b></div>
    <form class="card" id="f"><h2>تسجيل الدخول</h2>
      <label class="f">البريد الإلكتروني<input class="f" name="email" type="email" required autocomplete="email" dir="ltr"></label>
      <label class="f">كلمة المرور<input class="f" name="password" type="password" required autocomplete="current-password" dir="ltr"></label>
      <button class="btn">دخول</button><p class="tiny muted" id="msg">${/[?&]e=link/.test(location.hash) ? "الرابط منتهي أو غير صالح. اطلب رابطًا جديدًا." : ""}</p>
      <a class="tiny" href="#/forgot" style="align-self:flex-start">نسيت كلمة المرور؟</a></form>
    <a class="btn plain" href="#/signup">ليس لدي حساب</a></main>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const b = $("button", e.target); b.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.get("email").trim(), password: f.get("password") });
    b.disabled = false;
    if (error) return ($("#msg").textContent = friendly(error));
    await loadMe(); go("/");
  };
});

// Forgot password: Supabase emails a one-time link. The password itself is never stored by the app.
route("/forgot", () => {
  app.innerHTML = `${themeBtn("float")}<main class="narrow"><div class="auth-hero">${LOGO}<b>نَوء</b></div>
    <form class="card" id="f"><h2>استعادة كلمة المرور</h2><p class="small muted">اكتب بريدك، وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.</p>
      <label class="f">البريد الإلكتروني<input class="f" name="email" type="email" required autocomplete="email" dir="ltr"></label>
      <button class="btn">إرسال الرابط</button><p class="tiny muted" id="msg"></p></form>
    <a class="btn plain" href="#/login">العودة لتسجيل الدخول</a></main>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const b = $("button", e.target); b.disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(new FormData(e.target).get("email").trim(), { redirectTo: location.origin + location.pathname });
    b.disabled = false;
    $("#msg").textContent = error ? friendly(error) : "إذا كان البريد مسجّلًا، ستصلك رسالة خلال دقائق. افتح الرابط من الجهاز نفسه.";
  };
});

route("/reset", async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return go("/login?e=link");
  app.innerHTML = `${themeBtn("float")}<main class="narrow"><div class="auth-hero">${LOGO}<b>نَوء</b></div>
    <form class="card" id="f"><h2>كلمة مرور جديدة</h2>
      <label class="f">كلمة المرور الجديدة<input class="f" name="p1" type="password" required minlength="6" autocomplete="new-password" dir="ltr"></label>
      <label class="f">تأكيد كلمة المرور<input class="f" name="p2" type="password" required minlength="6" autocomplete="new-password" dir="ltr"></label>
      <button class="btn">حفظ</button><p class="tiny muted" id="msg"></p></form></main>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get("p1") !== f.get("p2")) return ($("#msg").textContent = "كلمتا المرور غير متطابقتين");
    const b = $("button", e.target); b.disabled = true;
    const { error } = await sb.auth.updateUser({ password: f.get("p1") });
    b.disabled = false;
    if (error) return ($("#msg").textContent = friendly(error));
    toast("تم تغيير كلمة المرور"); await loadMe(); go("/");
  };
});

route("/signup", () => {
  let role = "trainee";
  app.innerHTML = `${themeBtn("float")}<main class="narrow"><div class="auth-hero">${LOGO}<b>نَوء</b></div>
    <form class="card" id="f"><h2>إنشاء حساب</h2>
      <div class="seg" role="group" aria-label="نوع الحساب"><button type="button" data-r="trainee" aria-pressed="true">متدرب</button><button type="button" data-r="trainer" aria-pressed="false">مدرب</button></div>
      <label class="f">الاسم<input class="f" name="name" required maxlength="60" autocomplete="name"></label>
      <label class="f">البريد الإلكتروني<input class="f" name="email" type="email" required autocomplete="email" dir="ltr"></label>
      <label class="f">كلمة المرور<input class="f" name="password" type="password" required minlength="6" autocomplete="new-password" dir="ltr"></label>
      <label class="f" id="codeF" hidden>رمز اعتماد المدربين<input class="f" name="code" dir="ltr" autocomplete="off"><span class="tiny muted">تحصل عليه من إدارة القسم. يمنع أي أحد من التسجيل كمدرب.</span></label>
      <button class="btn">إنشاء الحساب</button><p class="tiny muted" id="msg"></p>
      <p class="tiny muted">نخزن الاسم والبريد فقط، ولا نرسلهما للذكاء الاصطناعي.</p></form>
    <a class="btn plain" href="#/login">عندي حساب</a></main>`;
  $$(".seg button").forEach((b) => (b.onclick = () => {
    role = b.dataset.r; $$(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    $("#codeF").hidden = role !== "trainer"; $("#codeF input").required = role === "trainer";
  }));
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const b = $("button.btn", e.target); b.disabled = true; $("#msg").textContent = "";
    const { data, error } = await sb.auth.signUp({ email: f.get("email").trim(), password: f.get("password"), options: { data: { full_name: f.get("name").trim() } } });
    if (error) { b.disabled = false; return ($("#msg").textContent = friendly(error)); }
    if (!data.session) { b.disabled = false; return ($("#msg").textContent = "وصلتك رسالة تفعيل على بريدك. فعّل الحساب ثم سجّل الدخول."); }
    if (role === "trainer") {
      const { error: e2 } = await sb.rpc("become_trainer", { p_code: f.get("code").trim() });
      if (e2) toast(friendly(e2) + ". تم إنشاء حسابك كمتدرب.", 4000);
    }
    await loadMe(); go("/");
  };
});

// ---------- trainee ----------
async function myClasses() {
  const { data } = await sb.from("members").select("class_id, classes(id,name,code,live_slide,live_at,live_lecture,trainer_id)").eq("user_id", me.id);
  return (data || []).map((r) => fixLive(r.classes)).filter(Boolean);
}
function currentClass(list) {
  const saved = localStorage.getItem("nawa.class");
  return list.find((c) => c.id === saved) || list[0];
}

route("/t/join", async () => {
  await loadMe(); if (!need("trainee")) return;
  const m = shell("t", "/t", `<div class="card"><h2>الانضمام لفصل</h2><p class="small muted">اكتب الرمز الذي يعرضه المدرب (6 خانات).</p>
    <form id="f" class="row"><input class="f grow" name="code" required maxlength="6" dir="ltr" style="text-transform:uppercase;letter-spacing:.2em;font-family:var(--f-mono)" placeholder="K3W9TB"><button class="btn">انضمام</button></form><p class="tiny muted" id="msg"></p></div>`, "narrow");
  $("#f", m).onsubmit = async (e) => {
    e.preventDefault(); const code = new FormData(e.target).get("code");
    const { data, error } = await sb.rpc("join_class", { p_code: code });
    if (error) return ($("#msg").textContent = friendly(error));
    localStorage.setItem("nawa.class", data); toast("تم الانضمام للفصل"); go("/t");
  };
});

async function loadTasksWithStatus(cls) {
  const [{ data: tasks }, { data: subs }] = await Promise.all([
    sb.from("tasks").select("id,title,topic,is_extra,target_user,lecture_id,slide,created_at").eq("class_id", cls.id).order("created_at", { ascending: false }),
    sb.from("submissions").select("task_id,submitted_at,ai_verdict").eq("user_id", me.id),
  ]);
  const sm = Object.fromEntries((subs || []).map((s) => [s.task_id, s]));
  return (tasks || []).map((t) => ({ ...t, sub: sm[t.id], st: !sm[t.id] ? "new" : sm[t.id].submitted_at ? "done" : "open" }));
}
// a lecture is a folded list: tap the name to show its exercises
function lecBlock(l, tasks, open = false) {
  const ts = tasks.filter((t) => t.lecture_id === l.id); const done = ts.filter((t) => t.st === "done").length;
  return `<details class="lec"${open ? " open" : ""}><summary class="lechead">${ICON.slides}<div class="grow"><b>${esc(l.title)}</b><div class="tiny muted">${ts.length ? `أنجزت ${done} من ${ts.length} تمارين` : "لا توجد تمارين بعد"} · ${ago(l.created_at)}</div></div><span class="fold" aria-hidden="true">⌄</span></summary>
    <div class="list">${ts.map(taskRow).join("")}<a href="#/t/lecture/${l.id}" class="openlec">${ICON.slides}<div class="grow t">فتح المحاضرة (الشرائح والمحرر)</div><span class="tiny">‹</span></a></div></details>`;
}
const taskRow = (t) => `<a href="#/t/task/${t.id}"><div class="grow"><div class="t">${esc(t.title)}</div><div class="tiny muted">${esc(t.topic)}${t.slide ? ` · الشريحة ${t.slide}` : ""}${t.target_user ? " · مُرسل لك" : ""}${t.is_extra ? " · إضافي" : ""}${t.st === "done" ? ` · سُلّم ${ago(t.sub.submitted_at)}` : ""}</div></div>
  ${statusChip(t)}</a>`;
// one chip only: after submitting, the result is the status
const statusChip = (t) => t.st === "done" ? (vchip(t.sub.ai_verdict) || `<span class="chip ok">تم التسليم</span>`) : `<span class="chip ${STATUS[t.st][1]}">${STATUS[t.st][0]}</span>`;

route("/t", async () => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const list = await myClasses(); if (!list.length) return go("/t/join");
  const cls = currentClass(list);
  const tasks = await loadTasksWithStatus(cls);
  const { data: lecs } = await sb.from("lectures").select("id,title,created_at").eq("class_id", cls.id).order("created_at", { ascending: false });
  const todo = tasks.filter((t) => t.st !== "done");
  const liveLec = cls.live_slide ? (lecs || []).find((l) => l.id === cls.live_lecture) || lecs?.[0] : null;
  const slideTask = cls.live_slide ? await slideTaskFor(cls.live_lecture, cls.live_slide) : null;
  const m = shell("t", "/t", `
    <div class="row"><div class="grow"><h1>أهلًا، ${esc(me.full_name || "")}</h1><p class="small muted">${esc(cls.name)}</p></div>
      ${list.length > 1 ? `<select class="f" id="cls" style="width:auto">${list.map((c) => `<option value="${c.id}" ${c.id === cls.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : ""}</div>
    <div class="card" id="live">${cls.live_slide ? `<span class="chip live" style="align-self:flex-start"><span class="dot"></span> الجلسة مباشرة الآن</span><p class="small">المدرب على الشريحة ${cls.live_slide}${liveLec ? ` من «${esc(liveLec.title)}»` : ""}. افتح المحاضرة وتابع معه.</p>${slideTask ? `<a class="btn" href="#/t/task/${slideTask.id}">تمرين هذه الشريحة: ${esc(slideTask.title)}</a>` : ""}${liveLec ? `<a class="btn live" href="#/t/lecture/${liveLec.id}">فتح المحاضرة</a>` : ""}` : `<span class="chip" style="align-self:flex-start">لا توجد جلسة الآن</span><p class="small muted">عند بدء الجلسة يظهر تنبيه هنا.</p>`}</div>
    <h3>المطلوب منك</h3>
    <div class="list">${todo.length ? todo.map(taskRow).join("") : `<div class="empty">لا توجد تمارين مفتوحة 👏</div>`}</div>
    ${lecs?.length ? `<h3>المحاضرات وتمارينها</h3>${lecs.slice(0, 3).map((l) => lecBlock(l, tasks)).join("")}${lecs.length > 3 ? `<a class="btn plain" href="#/t/tasks">كل المحاضرات</a>` : ""}` : ""}`);
  if (slideTask) popSlideTask(slideTask);
  const sel = $("#cls", m); if (sel) sel.onchange = () => { localStorage.setItem("nawa.class", sel.value); render(); };
  const ch = sb.channel("cls-" + cls.id).on("postgres_changes", { event: "UPDATE", schema: "public", table: "classes", filter: `id=eq.${cls.id}` }, () => render()).subscribe();
  onLeave(() => sb.removeChannel(ch));
});

route("/t/tasks", async () => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const list = await myClasses(); if (!list.length) return go("/t/join");
  const cls = currentClass(list);
  const tasks = await loadTasksWithStatus(cls);
  const { data: lecs } = await sb.from("lectures").select("id,title,created_at").eq("class_id", cls.id).order("created_at", { ascending: false });
  const loose = tasks.filter((t) => !t.lecture_id || !(lecs || []).some((l) => l.id === t.lecture_id));
  shell("t", "/t/tasks", `<h1>المحاضرات والتمارين</h1><p class="small muted">اضغط على اسم المحاضرة لعرض تمارينها.</p>
    ${(lecs || []).map((l, i) => lecBlock(l, tasks, i === 0)).join("")}
    ${loose.length ? `<details class="lec"><summary class="lechead">${ICON.code}<b class="grow">تمارين إضافية</b><span class="fold" aria-hidden="true">⌄</span></summary><div class="list">${loose.map(taskRow).join("")}</div></details>` : ""}
    ${!lecs?.length && !tasks.length ? `<div class="card empty">لم تصلك محاضرات أو تمارين بعد.</div>` : ""}`);
});

route("/t/task/:id", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const { data: task, error } = await sb.from("tasks").select("*, lectures(id,title,file_path,topics)").eq("id", id).single();
  if (error || !task) return shell("t", "/t/tasks", `<div class="card empty">التمرين غير موجود أو غير متاح لك.</div>`);
  const { data: sub, error: e2 } = await sb.rpc("open_task", { p_task: id });
  if (e2) return shell("t", "/t/tasks", `<div class="card empty">${esc(friendly(e2))}</div>`);
  const { data: notes } = await sb.from("notes").select("body,created_at").eq("submission_id", sub.id).order("created_at");
  const lec = task.lectures;
  const m = shell("t", "/t/tasks", `
    <div class="row"><a class="btn plain sm" href="#/t/tasks">→ المحاضرات</a><h2 class="grow">${esc(task.title)}</h2>${sub.submitted_at ? `<span class="tiny muted">سُلّم ${ago(sub.submitted_at)}</span>${vchip(sub.ai_verdict) || `<span class="chip ok">تم التسليم</span>`}` : ""}</div>
    <div class="ws task">
      <div class="card ta-q"><span class="chip new" style="align-self:flex-start">${esc(task.topic)}</span><p>${esc(task.prompt)}</p></div>
      <section class="pane ta-code">
        <div id="ws" class="pane"></div>
        <div class="row"><button class="btn grow" id="submit">${sub.submitted_at ? "إعادة التسليم" : "تسليم"}</button></div>
        <p class="ai-note">يُقيَّم الحل بالذكاء الاصطناعي حسب الناتج والمفهوم، وأي طريقة صحيحة مقبولة. القرار النهائي للمدرب.</p>
        <div id="result">${resultHTML(sub)}</div>
        ${(notes || []).map((n) => `<div class="card"><span class="tiny muted">ملاحظة من المدرب · ${ago(n.created_at)}</span><p class="small">${esc(n.body)}</p></div>`).join("")}
      </section>
      ${lec?.file_path ? `<div class="card ta-s"><div class="row"><b class="grow small">${task.slide ? `التمرين من الشريحة ${task.slide} · ` : ""}${esc(lec.title)}</b><span class="tiny muted" id="pg"></span></div><div class="slidebox"><canvas id="cv"></canvas></div>
        <div class="slidenav"><button class="btn plain sm" id="prev">›</button><span class="grow"></span><button class="btn plain sm" id="zoom">⤢ تكبير</button><button class="btn plain sm" id="next">‹</button></div></div>` : ""}
    </div>`, "wide");
  const ws = mountWorkspace($("#ws", m), { code: sub.code || task.starter_code || "", typed: sub.typed_chars || 0, pasted: sub.pasted_chars || 0 });
  // log errors for the trainer's "common errors" (message only, max once per message)
  const seen = new Set();
  const logErr = (msg) => { if (seen.has(msg)) return; seen.add(msg); sb.from("error_events").insert({ task_id: id, message: msg.slice(0, 300) }).then(() => {}); };
  window.addEventListener("message", (e) => { if (e.data?.nawa === "err") logErr(e.data.m); });
  // autosave draft
  let last = ws.code;
  const timer = setInterval(() => {
    if (ws.code === last) return; last = ws.code;
    sb.from("submissions").update({ code: ws.code, typed_chars: ws.stats.typed, pasted_chars: ws.stats.pasted }).eq("id", sub.id).then(() => {});
  }, 5000);
  onLeave(() => { clearInterval(timer); ws.destroy(); });

  if (lec?.file_path) mountSlides(m, lec.file_path, task.slide || 1);

  $("#submit", m).onclick = async (e) => {
    const b = e.target; b.disabled = true; b.innerHTML = '<span class="spinner"></span> جارٍ التسليم';
    const { output, errors } = await ws.runAndCollect();
    const { data: s2, error: e3 } = await sb.rpc("submit_task", { p_task: id, p_code: ws.code, p_typed: ws.stats.typed, p_pasted: ws.stats.pasted });
    if (e3) { b.disabled = false; b.textContent = "تسليم"; return toast(friendly(e3)); }
    $("#result", m).innerHTML = `<div class="card"><span class="small"><span class="spinner"></span> تم التسليم، جارٍ التقييم…</span></div>`;
    try {
      const r = await ai("grade", { submission_id: s2.id, output_text: output, errors });
      $("#result", m).innerHTML = resultHTML({ ...s2, ai_verdict: r.verdict, ai_feedback: r.feedback, submitted_at: s2.submitted_at });
    } catch (er) {
      $("#result", m).innerHTML = `<div class="card"><span class="chip ok" style="align-self:flex-start">تم التسليم</span><p class="small muted">التقييم الآلي غير متاح الآن (${esc(er.message)}). وسيطّلع المدرب على حلّك.</p></div>`;
    }
    b.disabled = false; b.textContent = "إعادة التسليم";
  };
});
function resultHTML(s) {
  if (!s.submitted_at) return "";
  const p = pct(s.typed_chars, s.pasted_chars);
  if (!s.ai_verdict) return `<div class="card"><span class="chip ok" style="align-self:flex-start">تم التسليم</span><span class="tiny muted">الكتابة اليدوية: ${p ?? "—"}%</span></div>`;
  return `<div class="verdict ${s.ai_verdict}"><b>${VERDICT[s.ai_verdict][0]}</b>${s.ai_feedback ? `<p class="small">${esc(s.ai_feedback)}</p>` : ""}
    ${s.ai_verdict !== "correct" ? `<p class="small"><b>لا بأس.</b> عدّل الكود حسب التلميح ثم اضغط «إعادة التسليم». المدرب يرى آخر نسخة.</p>` : ""}
    <span class="tiny muted">الكتابة اليدوية: ${p ?? "—"}% · ${s.trainer_override ? "قرار المدرب" : "تقييم الذكاء الاصطناعي، والقرار للمدرب"}</span></div>`;
}

// slides viewer (shared). follow = realtime class slide for trainees; onPage = trainer sets live slide
async function mountSlides(root, path, start = 1, { onPage, follow, onShow } = {}) {
  const cv = $("#cv", root); if (!cv) return;
  let doc, page = start;
  try {
    const { data, error } = await sb.storage.from("lectures").createSignedUrl(path, 3600);
    if (error) throw error;
    doc = await openPdf(data.signedUrl);
  } catch (e) { cv.parentElement.innerHTML = `<p class="small muted" style="padding:16px">تعذّر فتح الملف: ${esc(friendly(e))}</p>`; return; }
  const show = async (n, fromRemote = false) => {
    page = Math.max(1, Math.min(doc.numPages, n));
    await renderPage(doc, page, cv);
    const pg = $("#pg", root); if (pg) pg.textContent = `${page} / ${doc.numPages}`;
    if (!fromRemote && onPage) onPage(page);
    if (onShow) onShow(page);
  };
  const z = $("#zoom", root); if (z) z.onclick = () => { if (follow) follow.off(); zoomSlide(doc, page, (n) => show(n)); };
  $("#prev", root).onclick = () => { if (follow) follow.off(); show(page - 1); };
  $("#next", root).onclick = () => { if (follow) follow.off(); show(page + 1); };
  await show(page, true);
  return { show, get doc() { return doc; }, get page() { return page; } };
}

route("/t/lecture/:id", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const { data: lec } = await sb.from("lectures").select("*, classes!lectures_class_id_fkey(id,live_slide,live_at,live_lecture)").eq("id", id).single();
  fixLive(lec?.classes);
  if (!lec) return shell("t", "/t", `<div class="card empty">المحاضرة غير متاحة.</div>`);
  const { data: tasks } = await sb.from("tasks").select("id,title,topic,slide").eq("lecture_id", id).order("slide", { nullsFirst: false });
  const { data: mine } = await sb.from("slide_pulse").select("slide").eq("lecture_id", id);
  const lost = new Set((mine || []).map((x) => x.slide));
  let following = !!lec.classes?.live_slide;
  let wasLive = following;
  const m = shell("t", "/t", `
    <div class="row"><h2 class="grow">${esc(lec.title)}</h2>${lec.classes?.live_slide ? `<span class="chip live"><span class="dot"></span> مباشر</span>` : ""}
      <button class="switch" id="follow" aria-pressed="${following}"><i></i>متابعة شريحة المدرب</button></div>
    <div class="ws">
      <section class="pane"><div class="slidebox"><canvas id="cv"></canvas></div>
        <div class="slidenav"><button class="btn plain sm" id="prev">›</button><span class="grow small muted" id="pg" style="text-align:center"></span><button class="btn plain sm" id="zoom">⤢ تكبير</button><button class="btn plain sm" id="next">‹</button></div>
        <button class="pulse" id="pulse" aria-pressed="false">🤔 لم أفهم هذه الشريحة</button>
        <p class="tiny muted" style="margin-top:-6px">يصل للمدرب العدد فقط، بدون اسمك.</p>
        ${tasks?.length ? `<h3>تمارين هذه المحاضرة</h3><div class="list">${tasks.map((t) => `<a href="#/t/task/${t.id}"><div class="grow t">${esc(t.title)}</div>${t.slide ? `<span class="tiny muted">الشريحة ${t.slide}</span>` : ""}<span class="chip new">${esc(t.topic)}</span></a>`).join("")}</div>` : ""}</section>
      <section class="pane"><h3>جرّب أمثلة المحاضرة هنا</h3><div id="ws" class="pane"></div><p class="ai-note">مساحة تجربة حرة، لا تُحفظ ولا تُقيَّم.</p></section>
    </div>`, "wide");
  const ws = mountWorkspace($("#ws", m), { code: "<h1>مرحبا</h1>\n<script>\n  \n<\/script>" });
  const fbtn = $("#follow", m);
  const follow = { off() { following = false; fbtn.setAttribute("aria-pressed", "false"); } };
  const pb = $("#pulse", m); let cur = 1;
  const paintPulse = (n) => { cur = n; const on = lost.has(n); pb.setAttribute("aria-pressed", on); pb.textContent = on ? "✓ وصل للمدرب أن هذه الشريحة تحتاج توضيحًا (اضغط للتراجع)" : "🤔 لم أفهم هذه الشريحة"; };
  pb.onclick = async () => {
    const n = cur, on = lost.has(n); pb.disabled = true;
    const { error } = on ? await sb.from("slide_pulse").delete().eq("lecture_id", id).eq("slide", n) : await sb.from("slide_pulse").insert({ lecture_id: id, slide: n });
    pb.disabled = false; if (error) return toast(friendly(error));
    on ? lost.delete(n) : lost.add(n); paintPulse(n);
  };
  let sl; mountSlides(m, lec.file_path, lec.classes?.live_slide || 1, { follow, onShow: paintPulse }).then((x) => (sl = x));
  const checkPop = async (c) => { if (c.live_slide && c.live_lecture === id) { const t = await slideTaskFor(id, c.live_slide); if (t) popSlideTask(t); } };
  if (lec.classes?.live_slide) checkPop(lec.classes);
  fbtn.onclick = async () => {
    following = !following; fbtn.setAttribute("aria-pressed", following);
    if (following) { const { data } = await sb.from("classes").select("live_slide").eq("id", lec.class_id).single(); if (data?.live_slide && sl) sl.show(data.live_slide, true); }
  };
  const ch = sb.channel("live-" + lec.class_id).on("postgres_changes", { event: "UPDATE", schema: "public", table: "classes", filter: `id=eq.${lec.class_id}` },
    (p) => {
      // a session that just started turns «متابعة شريحة المدرب» on by itself
      if (p.new.live_slide && !wasLive && p.new.live_lecture === id) { following = true; fbtn.setAttribute("aria-pressed", "true"); }
      wasLive = !!p.new.live_slide;
      if (following && p.new.live_slide && sl) sl.show(p.new.live_slide, true); checkPop(p.new);
    }).subscribe();
  onLeave(() => { sb.removeChannel(ch); ws.destroy(); });
});

route("/t/practice", async () => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const list = await myClasses(); if (!list.length) return go("/t/join");
  const tasks = await loadTasksWithStatus(currentClass(list));
  const topics = [...new Set(tasks.map((t) => t.topic))];
  const m = shell("t", "/t/practice", `<h1>التدريب</h1><p class="small muted">اختبارات قصيرة بدون درجة، يولّدها الذكاء الاصطناعي من مواضيع فصلك.</p>
    <div class="btns" id="topics">${topics.length ? topics.map((t) => `<button class="btn ghost" data-t="${esc(t)}">${esc(t)}</button>`).join("") : `<span class="muted small">تظهر المواضيع بعد أن يرسل المدرب التمارين.</span>`}</div>
    <div id="quiz" class="quiz"></div>`, "narrow");
  $$("#topics button", m).forEach((b) => (b.onclick = async () => {
    const box = $("#quiz", m); box.innerHTML = `<div class="card"><span class="spinner"></span></div>`;
    try {
      const { questions } = await ai("quiz", { topic: b.dataset.t });
      box.innerHTML = questions.map((q, i) => `<div class="card" data-q="${i}"><b>${i + 1}. ${esc(q.q)}</b>${q.options.map((o, j) => `<button class="opt" data-j="${j}">${esc(o)}</button>`).join("")}<p class="small muted" hidden>${esc(q.why)}</p></div>`).join("") + `<p class="ai-note">أسئلة من الذكاء الاصطناعي للتدريب فقط، وقد تحتوي أخطاء.</p>`;
      $$("[data-q]", box).forEach((c) => {
        const q = questions[+c.dataset.q];
        $$(".opt", c).forEach((o) => (o.onclick = () => {
          $$(".opt", c).forEach((x) => { x.disabled = true; if (+x.dataset.j === q.answer) x.dataset.s = "right"; });
          if (+o.dataset.j !== q.answer) o.dataset.s = "wrong"; $("p", c).hidden = false;
        }));
      });
    } catch (e) { box.innerHTML = `<div class="card small">${esc(e.message)}</div>`; }
  }));
});

function meView(role) {
  return async () => {
    await loadMe(); if (!need(role === "m" ? "trainer" : "trainee")) return;
    const m = shell(role, `/${role}/me`, `<h1>حسابي</h1>
      <form class="card" id="f"><label class="f">الاسم<input class="f" name="name" value="${esc(me.full_name)}" maxlength="60"></label><button class="btn plain">حفظ</button></form>
      <div class="card"><span class="small muted">البريد</span><span dir="ltr" style="text-align:end">${esc(me.email)}</span><span class="small muted">نوع الحساب: ${me.role === "trainer" ? "مدرب" : "متدرب"}</span></div>
      ${role === "t" ? `<a class="btn plain" href="#/t/join">+ الانضمام لفصل آخر</a>` : ""}
      <div class="card small"><b>خصوصيتك</b><p class="muted">لا نرسل اسمك أو بريدك للذكاء الاصطناعي، فقط نص التمرين والكود ورسالة الخطأ. ولا يطّلع المدرب إلا على فصله.</p></div>
      <button class="btn danger" id="out">تسجيل الخروج</button>`, "narrow");
    $("#f", m).onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.from("profiles").update({ full_name: new FormData(e.target).get("name").trim() }).eq("id", me.id); toast(error ? friendly(error) : "تم الحفظ"); };
    $("#out", m).onclick = async () => { await sb.auth.signOut(); me = null; go("/welcome"); };
  };
}
route("/t/me", meView("t"));
route("/m/me", meView("m"));

// ---------- trainer ----------
route("/m", async () => {
  loading(); await loadMe(); if (!need("trainer")) return;
  const { data: classes } = await sb.from("classes").select("id,name,code,live_slide,live_at,created_at").eq("trainer_id", me.id).order("created_at");
  (classes || []).forEach(fixLive);
  const m = shell("m", "/m", `<h1>فصولي</h1>
    <div class="list">${classes?.length ? classes.map((c) => `<a href="#/m/class/${c.id}"><div class="grow"><div class="t">${esc(c.name)}</div><div class="tiny muted">الرمز <span class="mono">${c.code}</span></div></div>${c.live_slide ? `<span class="chip live"><span class="dot"></span> مباشر</span>` : ""}</a>`).join("") : `<div class="empty">أنشئ أول فصل.</div>`}</div>
    <form class="card" id="f"><h3>فصل جديد</h3><div class="row"><input class="f grow" name="name" required maxlength="80" placeholder="مثال: برمجة الويب 1 · شعبة 204"><button class="btn">إنشاء</button></div></form>`, "narrow");
  $("#f", m).onsubmit = async (e) => {
    e.preventDefault(); const { data, error } = await sb.rpc("create_class", { p_name: new FormData(e.target).get("name") });
    if (error) return toast(friendly(error)); go("/m/class/" + data.id);
  };
});

route("/m/class/:id", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainer")) return;
  const [{ data: c }, { data: lecs }, { data: tasks }, { count: nMem }] = await Promise.all([
    sb.from("classes").select("*").eq("id", id).single(),
    sb.from("lectures").select("id,title,hidden,created_at").eq("class_id", id).order("created_at", { ascending: false }),
    sb.from("tasks").select("id,title,topic,target_user,lecture_id,slide,created_at,submissions(submitted_at)").eq("class_id", id).order("created_at", { ascending: false }),
    sb.from("members").select("user_id", { count: "exact", head: true }).eq("class_id", id),
  ]);
  if (!c) return shell("m", "/m", `<div class="card empty">الفصل غير موجود.</div>`);
  fixLive(c);
  const mTaskRow = (t) => { const done = (t.submissions || []).filter((s) => s.submitted_at).length, all = t.target_user ? 1 : nMem ?? 0;
    return `<a href="#/m/task/${t.id}"><div class="grow"><div class="t">${esc(t.title)}</div><div class="tiny muted">${esc(t.topic)}${t.slide ? ` · الشريحة ${t.slide}` : ""}${t.target_user ? " · لمتدرب محدد" : ""}</div></div><span class="chip ${all && done >= all ? "ok" : ""}">سلّم ${done} من ${all}</span></a>`; };
  const m = shell("m", "/m", `
    <div class="row"><a class="btn plain sm" href="#/m">→ فصولي</a><h1 class="grow">${esc(c.name)}</h1>
      ${c.live_slide ? `<span class="chip live"><span class="dot"></span> الجلسة مباشرة</span><button class="btn plain sm" id="end">إنهاء الجلسة</button>` : ""}</div>
    <div class="grid">
      <div class="card" style="text-align:center"><span class="small muted">رمز الفصل للعرض على الشاشة</span><div class="big-code">${c.code}</div><span class="small muted">${nMem ?? 0} متدرب في الفصل</span><div class="row" style="justify-content:center"><button class="btn plain sm" id="copy">نسخ الرمز</button><button class="btn plain sm" id="newcode">رمز جديد</button></div><span class="tiny muted">الرمز الجديد يوقف القديم، ويبقى المنضمون في الفصل.</span></div>
      <div class="card"><h3>المتابعة</h3><a class="btn" href="#/m/class/${id}/dash">${ICON.chart} لوحة الالتزام والأخطاء الشائعة</a>
        <p class="small muted">من أنجز، ونسبة الكتابة اليدوية، ووقت الحل، والأخطاء المتكررة.</p></div>
    </div>
    <h3>المحاضرات وتمارينها</h3>
    ${lecs?.length ? lecs.map((l, i) => { const ts = (tasks || []).filter((t) => t.lecture_id === l.id);
      return `<details class="lec"${i === 0 ? " open" : ""}><summary class="lechead">${ICON.slides}<div class="grow"><b>${esc(l.title)}</b><div class="tiny muted">${ts.length} تمارين مرسلة · ${ago(l.created_at)}</div></div>${l.hidden ? `<span class="chip">مخفية</span>` : ""}<span class="fold" aria-hidden="true">⌄</span></summary>
        <div class="list">${ts.map(mTaskRow).join("")}<a href="#/m/lecture/${l.id}" class="openlec">${ICON.slides}<div class="grow t">فتح المحاضرة: العرض المباشر والمواضيع وتوليد التمارين</div><span class="tiny">‹</span></a></div></details>`; }).join("")
      : `<div class="card empty">ارفع أول محاضرة (PDF) من «رفع محاضرة جديدة» تحت.</div>`}
    ${(() => { const loose = (tasks || []).filter((t) => !t.lecture_id); return loose.length ? `<details class="lec"><summary class="lechead">${ICON.code}<div class="grow"><b>تمارين إضافية</b><div class="tiny muted">${loose.length} تمارين بدون محاضرة</div></div><span class="fold" aria-hidden="true">⌄</span></summary><div class="list">${loose.map(mTaskRow).join("")}</div></details>` : ""; })()}
    <h3>إضافة</h3>
    <details class="card"${lecs?.length ? "" : " open"}><summary><b>＋ رفع محاضرة جديدة</b></summary>
      <form class="pane" id="up">
        <label class="f">العنوان<input class="f" name="title" maxlength="100" placeholder="اختياري: يؤخذ من اسم الملف"></label>
        <label class="f">ملف PDF (حتى 15 ميجا)<input class="f" name="file" type="file" accept="application/pdf,.pdf"><span class="tiny muted">إذا كان العرض بوربوينت، احفظه PDF أولًا.</span></label>
        <button class="btn">رفع</button><p class="small" id="upmsg" style="color:var(--bad)"></p></form></details>
    <details class="card"><summary><b>＋ إضافة تمرين يدوي</b></summary>${taskForm()}</details>
    <details class="card"><summary><b>⚙ إعدادات الشعبة</b></summary>
      <form class="row" id="ren"><input class="f grow" name="name" required maxlength="80" value="${esc(c.name)}"><button class="btn plain">حفظ الاسم</button></form>
      <button class="btn plain" id="del">حذف الشعبة</button>
      <span class="tiny muted">الحذف نهائي: تُحذف المحاضرات والتمارين وتسليمات المتدربين في هذه الشعبة.</span></details>`, "");
  $("#ren", m).onsubmit = async (e) => {
    e.preventDefault(); const { error } = await sb.from("classes").update({ name: new FormData(e.target).get("name").trim() }).eq("id", id);
    toast(error ? friendly(error) : "تم تغيير الاسم"); if (!error) render();
  };
  twoTap($("#del", m), "اضغط مرة ثانية لتأكيد الحذف", async () => {
    // files first (only the class trainer can remove them; the demo class's files are protected)
    const { data: files } = await sb.storage.from("lectures").list(id, { limit: 1000 });
    if (files?.length) await sb.storage.from("lectures").remove(files.map((f) => `${id}/${f.name}`));
    const { error } = await sb.from("classes").delete().eq("id", id);
    if (error) return toast(friendly(error), 4000);
    toast("حُذفت الشعبة"); go("/m");
  });
  $("#copy", m).onclick = () => { navigator.clipboard?.writeText(c.code); toast("تم نسخ الرمز"); };
  $("#newcode", m).onclick = async (e) => {
    const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "تأكيد تغيير الرمز"; return; }
    const { error } = await sb.rpc("new_class_code", { p_class: id }); toast(error ? friendly(error) : "تم إنشاء رمز جديد"); if (!error) render();
  };
  const end = $("#end", m); if (end) end.onclick = async () => { await sb.from("classes").update({ live_slide: null, live_lecture: null }).eq("id", id); render(); };
  $("#up", m).onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const b = $("button", e.target); $("#upmsg").textContent = "";
    b.disabled = true; b.innerHTML = '<span class="spinner"></span> جارٍ الرفع';
    let path;
    try { path = await uploadPdf(id, f.get("file")); }
    catch (er) { b.disabled = false; b.textContent = "رفع"; return ($("#upmsg").textContent = friendly(er)); }
    const { data: lec, error: e2 } = await sb.from("lectures").insert({ class_id: id, title: (f.get("title") || "").trim() || f.get("file").name.replace(/\.pdf$/i, "").slice(0, 100), file_path: path }).select().single();
    if (e2) { b.disabled = false; b.textContent = "رفع"; return ($("#upmsg").textContent = friendly(e2)); }
    go("/m/lecture/" + lec.id + "?extract=1");
  };
  bindTaskForm(m, id, null);
});

function taskForm(d = {}, i = "") {
  return `<div class="pane" data-task="${i}">
    <label class="f">الموضوع<input class="f" name="topic" value="${esc(d.topic || "")}" required maxlength="60"></label>
    <label class="f">العنوان<input class="f" name="title" value="${esc(d.title || "")}" required maxlength="100"></label>
    <label class="f">المطلوب<textarea class="f" name="prompt" rows="2" required>${esc(d.prompt || "")}</textarea></label>
    <label class="f">الناتج المتوقع والمفهوم (للتقييم فقط، لا يظهر للمتدرب)<textarea class="f" name="expected" rows="2">${esc(d.expected || "")}</textarea></label>
    <label class="f">كود البداية<textarea class="f mono" name="starter_code" rows="4" dir="ltr">${esc(d.starter_code || "")}</textarea></label>
    <label class="f">رقم الشريحة (اختياري)<input class="f" name="slide" type="number" min="1" max="999" value="${d.slide ?? ""}" style="max-width:120px"><span class="tiny muted">«تمرين الشريحة»: يظهر التمرين للمتدربين تلقائيًا عندما تصل لهذه الشريحة في الجلسة المباشرة.</span></label>
    ${i === "" ? `<button class="btn" data-send-one>إرسال للفصل كاملًا</button>` : ""}</div>`;
}
function readTask(el) { const g = (n) => $(`[name="${n}"]`, el).value.trim(); const sl = parseInt(g("slide"), 10); return { topic: g("topic"), title: g("title"), prompt: g("prompt"), expected: g("expected"), starter_code: $(`[name="starter_code"]`, el).value, slide: sl > 0 ? sl : null }; }
function bindTaskForm(m, classId, lectureId) {
  const b = $("[data-send-one]", m); if (!b) return;
  b.onclick = async (e) => {
    e.preventDefault(); const t = readTask(b.closest("[data-task]"));
    if (!t.topic || !t.title || !t.prompt) return toast("أكمل الموضوع والعنوان والمطلوب");
    const { error } = await sb.from("tasks").insert({ ...t, class_id: classId, lecture_id: lectureId });
    toast(error ? friendly(error) : "أُرسل التمرين للفصل"); if (!error) render();
  };
}

route("/m/lecture/:id", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainer")) return;
  const { data: lec } = await sb.from("lectures").select("*, classes!lectures_class_id_fkey(id,name,live_slide,live_at,live_lecture)").eq("id", id).single();
  fixLive(lec?.classes);
  if (!lec) return shell("m", "/m", `<div class="card empty">المحاضرة غير موجودة.</div>`);
  const { data: members } = await sb.from("members").select("user_id, profiles(full_name)").eq("class_id", lec.class_id);
  const live = !!lec.classes.live_slide && (!lec.classes.live_lecture || lec.classes.live_lecture === id);
  const { data: ltasks } = await sb.from("tasks").select("id,title,slide").eq("lecture_id", id).order("slide", { nullsFirst: false });
  const m = shell("m", "/m", `
    <div class="row"><a class="btn plain sm" href="#/m/class/${lec.class_id}">→ ${esc(lec.classes.name)}</a><h2 class="grow">${esc(lec.title)}</h2>
      <button class="btn ${live ? "plain" : "live"} sm" id="live">${live ? "إنهاء الجلسة" : "بدء الجلسة المباشرة"}</button></div>
    <div class="ws">
      <section class="pane"><div class="slidebox"><canvas id="cv"></canvas></div>
        <div class="slidenav"><button class="btn plain sm" id="prev">›</button><span class="grow small muted" id="pg" style="text-align:center"></span><button class="btn plain sm" id="zoom">⤢ تكبير</button><button class="btn plain sm" id="next">‹</button></div>
        <div id="here"></div>
        <p class="tiny muted" id="livehint">${live ? "المتدربون الذين فعّلوا «متابعة شريحة المدرب» يتنقلون معك." : "ابدأ الجلسة ليتابع المتدربون الشريحة معك."}</p>
        <div class="card"><div class="row"><h3 class="grow">نبض الشريحة</h3><span class="tiny muted">يتحدّث كل بضع ثوانٍ</span></div>
          <p class="tiny muted">عدد المتدربين الذين ضغطوا «لم أفهم» على كل شريحة. لا تظهر الأسماء.</p><div class="btns" id="pulses"><span class="small muted">لا أحد حتى الآن.</span></div>
          <div id="simp"></div></div>
        <div class="card"><h3>تمارين الشرائح</h3><p class="tiny muted">اربط التمرين برقم شريحة، فيظهر للمتدربين لحظة وصولك لها في الجلسة المباشرة.</p>
          ${ltasks?.length ? ltasks.map((t) => `<div class="row small"><a class="grow" href="#/m/task/${t.id}">${esc(t.title)}</a><label class="row tiny">الشريحة<input class="f" type="number" min="1" max="999" data-slide="${t.id}" value="${t.slide ?? ""}" style="width:76px"></label></div>`).join("") : `<p class="small muted">لا توجد تمارين لهذه المحاضرة بعد.</p>`}</div>
        <details class="card"><summary><b>إدارة المحاضرة</b></summary>
          <form class="row" id="ren"><input class="f grow" name="title" required maxlength="100" value="${esc(lec.title)}"><button class="btn plain">حفظ العنوان</button></form>
          <form class="pane" id="rep"><label class="f">استبدال الملف (PDF)<input class="f" name="file" type="file" accept="application/pdf,.pdf"></label><button class="btn plain">استبدال الملف</button><p class="small" id="repmsg" style="color:var(--bad)"></p></form>
          <button class="switch" id="hide" aria-pressed="${!!lec.hidden}"><i></i>إخفاء المحاضرة عن المتدربين</button>
          <span class="tiny muted">المخفية لا يراها المتدربون حتى تُظهرها. التمارين المرسلة تبقى كما هي.</span>
          <button class="btn plain" id="dellec">حذف المحاضرة</button></details></section>
      <section class="pane">
        <div class="card"><div class="row"><h3 class="grow">المواضيع</h3><button class="btn ghost sm" id="extract">${lec.topics?.length ? "إعادة الاستخراج" : "استخراج المواضيع بالذكاء"}</button></div>
          <div id="topics">${topicsHTML(lec.topics)}</div>
          <button class="btn" id="gen" ${lec.topics?.length ? "" : "hidden"}>توليد تمارين للمواضيع المختارة</button>
          <p class="ai-note">المواضيع والتمارين اقتراحات من الذكاء الاصطناعي. أنت تراجعها وتعدّلها وتقرر إرسالها أو لا.</p></div>
        <div id="drafts"></div>
      </section>
    </div>`, "wide");
  let sl;
  const setLive = async (n) => {
    if (!live) return;
    await sb.from("classes").update({ live_slide: n }).eq("id", lec.class_id);
    const t = (ltasks || []).find((x) => x.slide === n); if (t) toast(`ظهر «${t.title}» للمتدربين الآن (تمرين الشريحة ${n})`, 3500);
  };
  let counts = {};
  const paintHere = (n) => {
    const t = (ltasks || []).filter((x) => x.slide === n), c = counts[n] || 0;
    $("#here", m).innerHTML = (t.length ? `<div class="here">📌 على هذه الشريحة تمرين: <b>${esc(t.map((x) => x.title).join("، "))}</b>${live ? " (يظهر للمتدربين الآن)" : ""}</div>` : "")
      + (c ? `<div class="here bad">🤔 ${c} لم يفهموا هذه الشريحة <button class="btn plain sm" data-simp="${n}">اقترح شرحًا أبسط</button></div>` : "");
    const sb2 = $("[data-simp]", m); if (sb2) sb2.onclick = () => simplify(n);
  };
  const slReady = mountSlides(m, lec.file_path, (live && lec.classes.live_slide) || 1, { onPage: setLive, onShow: paintHere }).then((x) => (sl = x)); // buttons work while the PDF loads
  $("#live", m).onclick = async () => {
    await sb.from("classes").update(live ? { live_slide: null, live_lecture: null } : { live_slide: sl?.page || 1, live_lecture: id }).eq("id", lec.class_id);
    toast(live ? "انتهت الجلسة" : "بدأت الجلسة، وسيظهر التنبيه للمتدربين"); render();
  };
  // «نبض الشريحة»: counts only, refreshed every few seconds
  const loadPulse = async () => {
    const { data } = await sb.rpc("pulse_counts", { p_lecture: id }); if (!data) return;
    counts = Object.fromEntries(data.map((r) => [r.slide, r.n]));
    $("#pulses", m).innerHTML = data.length ? data.map((r) => `<button class="chip ${r.n >= 3 ? "bad" : "new"}" data-go="${r.slide}">الشريحة ${r.slide}: ${r.n}</button>`).join("") : `<span class="small muted">لا أحد حتى الآن.</span>`;
    $$("[data-go]", m).forEach((b) => (b.onclick = () => sl && sl.show(+b.dataset.go)));
    if (sl) paintHere(sl.page);
  };
  loadPulse(); const pt = setInterval(loadPulse, 6000); onLeave(() => clearInterval(pt));
  const simplify = async (n) => {
    const box = $("#simp", m); box.innerHTML = `<p class="small"><span class="spinner"></span> يجهّز شرحًا أبسط للشريحة ${n}…</p>`;
    try {
      const pageText = (await (await sl.doc.getPage(n)).getTextContent()).items.map((x) => x.str).join(" ");
      const r = await ai("simplify", { lecture_id: id, text: pageText, count: counts[n] || 0 });
      box.innerHTML = `<div class="card" style="background:var(--sunk)"><b class="small">اقتراح لشرح الشريحة ${n} بطريقة أبسط</b>
        <p class="small"><b>لماذا قد لا يفهمون:</b> ${esc(r.why)}</p><p class="small"><b>اشرحها هكذا:</b> ${esc(r.explain)}</p>
        ${r.example ? `<pre class="errsnip" dir="ltr">${esc(r.example)}</pre>` : ""}<p class="small"><b>اسأل للتأكد:</b> ${esc(r.check)}</p>
        <p class="ai-note">اقتراح من الذكاء الاصطناعي، والقرار لك. لا تُرسل أي أسماء، فقط نص الشريحة والعدد.</p></div>`;
    } catch (e) { box.innerHTML = `<p class="small">${esc(e.message)}</p>`; }
  };
  $$("[data-slide]", m).forEach((inp) => (inp.onchange = async () => {
    const v = parseInt(inp.value, 10) || null; const { error } = await sb.from("tasks").update({ slide: v }).eq("id", inp.dataset.slide);
    if (error) return toast(friendly(error)); const t = ltasks.find((x) => x.id === inp.dataset.slide); if (t) t.slide = v; if (sl) paintHere(sl.page);
    toast(v ? `رُبط التمرين بالشريحة ${v}` : "أُلغي ربط الشريحة");
  }));
  // manage lecture: rename, replace file, hide, delete
  $("#ren", m).onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.from("lectures").update({ title: new FormData(e.target).get("title").trim() }).eq("id", id); toast(error ? friendly(error) : "تم الحفظ"); if (!error) render(); };
  $("#rep", m).onsubmit = async (e) => {
    e.preventDefault(); const b = $("button", e.target); b.disabled = true; b.innerHTML = '<span class="spinner"></span> جارٍ الرفع'; $("#repmsg", m).textContent = "";
    try {
      const path = await uploadPdf(lec.class_id, new FormData(e.target).get("file"));
      const { error } = await sb.from("lectures").update({ file_path: path }).eq("id", id);
      if (error) { await sb.storage.from("lectures").remove([path]); throw error; }
      if (lec.file_path) await sb.storage.from("lectures").remove([lec.file_path]);
      toast("تم استبدال الملف"); render();
    } catch (er) { b.disabled = false; b.textContent = "استبدال الملف"; $("#repmsg", m).textContent = friendly(er); }
  };
  $("#hide", m).onclick = async (e) => {
    const v = e.currentTarget.getAttribute("aria-pressed") !== "true";
    const { error } = await sb.from("lectures").update({ hidden: v }).eq("id", id);
    toast(error ? friendly(error) : v ? "أُخفيت المحاضرة عن المتدربين" : "ظهرت المحاضرة للمتدربين"); if (!error) render();
  };
  twoTap($("#dellec", m), "اضغط مرة ثانية لتأكيد الحذف", async () => {
    const { error } = await sb.from("lectures").delete().eq("id", id);
    if (error) return toast(friendly(error), 4000);
    if (lec.file_path) await sb.storage.from("lectures").remove([lec.file_path]);
    toast("حُذفت المحاضرة"); go("/m/class/" + lec.class_id);
  });
  const doExtract = async () => {
    const b = $("#extract", m); b.disabled = true; b.innerHTML = '<span class="spinner"></span> يقرأ المحاضرة';
    try {
      await slReady; if (!sl) throw new Error("تعذّر فتح ملف المحاضرة");
      const text = await extractText(sl.doc);
      if (text.replace(/\[صفحة \d+\]|\s/g, "").length < 40) throw new Error("تعذّرت قراءة نص من الملف (ربما يحتوي صورًا فقط). أضف التمارين يدويًا.");
      const { topics } = await ai("topics", { lecture_id: id, text });
      lec.topics = topics; $("#topics", m).innerHTML = topicsHTML(topics); $("#gen", m).hidden = !topics.length;
    } catch (e) { toast(e.message, 4000); }
    b.disabled = false; b.textContent = "إعادة الاستخراج";
  };
  $("#extract", m).onclick = doExtract;
  if (location.hash.includes("extract=1") && !lec.topics?.length) { history.replaceState(null, "", "#/m/lecture/" + id); doExtract(); }
  $("#gen", m).onclick = async (e) => {
    const chosen = $$("#topics input:checked", m).map((x) => lec.topics[+x.value]);
    if (!chosen.length) return toast("اختر موضوعًا واحدًا على الأقل");
    const b = e.target; b.disabled = true; b.innerHTML = '<span class="spinner"></span> يجهّز التمارين';
    try {
      const { tasks } = await ai("tasks", { class_id: lec.class_id, topics: chosen });
      tasks.forEach((t, i) => { if (!t.slide) t.slide = (chosen.find((c) => c.topic === t.topic) || chosen[i])?.page ?? null; });
      $("#drafts", m).innerHTML = `<div class="card"><h3>مسودات التمارين</h3><p class="small muted">راجع وعدّل، ثم اختر لمن ترسل.</p>
        <div id="dlist">${tasks.map((t, i) => draftCard(t, i)).join("")}</div>
        <div class="sendbar"><div class="seg" role="group"><button type="button" data-to="all" aria-pressed="true">الفصل كاملًا</button><button type="button" data-to="one" aria-pressed="false">متدرب محدد</button></div>
        <select class="f" id="who" hidden>${(members || []).map((x) => `<option value="${x.user_id}">${esc(x.profiles?.full_name || "متدرب")}</option>`).join("")}</select>
        <div class="row"><button type="button" class="btn plain" id="addone">＋ تمرين من عندك</button><button class="btn grow" id="send">إرسال التمارين المختارة</button></div></div></div>`;
      let n = tasks.length;
      const count = () => { const k = $$("[data-pick]:checked", m).length; $("#send", m).textContent = k ? `إرسال ${k} ${k === 1 ? "تمرين" : k === 2 ? "تمرينين" : k <= 10 ? "تمارين" : "تمرينًا"}` : "اختر تمرينًا للإرسال"; };
      $("#dlist", m).onchange = (ev) => { if (ev.target.matches("[data-pick]")) count(); };
      $("#addone", m).onclick = () => { const w = document.createElement("div"); w.innerHTML = draftCard({ topic: chosen[0]?.topic || "", starter_code: "<!DOCTYPE html>\n<html>\n<head>\n</head>\n<body>\n\n</body>\n</html>" }, n++); const c = w.firstElementChild; $("#dlist", m).append(c); count(); $('[name="title"]', c).focus(); };
      count();
      let to = "all";
      $$("[data-to]", m).forEach((x) => (x.onclick = () => { to = x.dataset.to; $$("[data-to]", m).forEach((y) => y.setAttribute("aria-pressed", y === x)); $("#who", m).hidden = to !== "one"; }));
      $("#send", m).onclick = async () => {
        const rows = $$("[data-pick]:checked", m).map((x) => ({ ...readTask($(`[data-task="${x.dataset.pick}"]`, m)), class_id: lec.class_id, lecture_id: id, target_user: to === "one" ? $("#who", m).value : null }));
        if (!rows.length) return toast("اختر تمرينًا واحدًا على الأقل");
        if (rows.some((r) => !r.topic || !r.title || !r.prompt)) return toast("أكمل الموضوع والعنوان والمطلوب في كل تمرين مختار");
        if (to === "one" && !$("#who", m).value) return toast("لا يوجد متدربون في الفصل بعد");
        const { error } = await sb.from("tasks").insert(rows);
        if (error) return toast(friendly(error));
        toast(`أُرسل ${rows.length} تمرين`); go("/m/class/" + lec.class_id);
      };
    } catch (er) { toast(er.message, 4000); }
    b.disabled = false; b.textContent = "توليد تمارين للمواضيع المختارة";
  };
});
const draftCard = (t, i) => `<div class="card" style="background:var(--sunk)"><label class="row small"><input type="checkbox" checked data-pick="${i}"> إرسال هذا التمرين</label>${taskForm(t, i)}</div>`;
const topicsHTML = (ts) => ts?.length ? ts.map((t, i) => `<label class="row small" style="align-items:flex-start"><input type="checkbox" value="${i}" checked style="margin-top:5px"><span class="grow"><b>${esc(t.topic)}</b> <span class="tiny muted">ص ${t.page ?? "—"}</span><br><span class="muted">${esc(t.summary)}</span></span></label>`).join("") : `<p class="small muted">لم تُستخرج مواضيع بعد.</p>`;

route("/m/task/:id", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainer")) return;
  const { data: t } = await sb.from("tasks").select("*").eq("id", id).single();
  if (!t) return shell("m", "/m", `<div class="card empty">التمرين غير موجود.</div>`);
  const [{ data: subs }, { data: members }] = await Promise.all([
    sb.from("submissions").select("*").eq("task_id", id),
    sb.from("members").select("user_id, profiles(full_name)").eq("class_id", t.class_id),
  ]);
  const sm = Object.fromEntries((subs || []).map((s) => [s.user_id, s]));
  const rows = (members || []).filter((x) => !t.target_user || x.user_id === t.target_user).map((x) => ({ name: x.profiles?.full_name || "متدرب", s: sm[x.user_id] }));
  rows.sort((a, b) => (b.s?.submitted_at ? 1 : 0) - (a.s?.submitted_at ? 1 : 0));
  shell("m", "/m", `<div class="row"><a class="btn plain sm" href="#/m/class/${t.class_id}">→ الفصل</a><h2 class="grow">${esc(t.title)}</h2></div>
    <div class="card"><span class="chip new" style="align-self:flex-start">${esc(t.topic)}</span><p class="small">${esc(t.prompt)}</p></div>
    <details class="card" id="edit"><summary><b>تعديل التمرين</b></summary>${taskForm(t, "edit")}
      <div class="row"><button class="btn grow" id="save">حفظ التعديل</button><button class="btn plain" id="deltask">حذف التمرين</button></div>
      <span class="tiny muted">التعديل يظهر للمتدربين فورًا. كود البداية الجديد يظهر لمن لم يفتح التمرين بعد.</span></details>
    <div class="list">${rows.length ? rows.map(({ name, s }) => {
      const p = s ? pct(s.typed_chars, s.pasted_chars) : null;
      const inner = `<div class="grow"><div class="t">${esc(name)}</div><div class="tiny muted">${!s ? "لم يفتح التمرين" : s.submitted_at ? `كتابة يدوية ${p ?? "—"}% · وقت الحل ${fmtMin(Math.round((new Date(s.submitted_at) - new Date(s.opened_at)) / 60000))}${s.pasted_chars ? " · يوجد لصق" : ""}` : "قيد الحل الآن"}</div></div>
        ${s?.submitted_at ? vchip(s.ai_verdict) || `<span class="chip ok">تم التسليم</span>` : `<span class="chip">${s ? "فُتح ولم يُسلَّم" : "لم يبدأ"}</span>`}`;
      return s?.submitted_at ? `<a href="#/m/sub/${s.id}">${inner}</a>` : `<div>${inner}</div>`; }).join("") : `<div class="empty">لا يوجد متدربون في الفصل بعد.</div>`}</div>`, "narrow");
  $("#save").onclick = async () => {
    const v = readTask($('[data-task="edit"]')); if (!v.topic || !v.title || !v.prompt) return toast("أكمل الموضوع والعنوان والمطلوب");
    const { error } = await sb.from("tasks").update(v).eq("id", id); toast(error ? friendly(error) : "تم حفظ التعديل"); if (!error) render();
  };
  twoTap($("#deltask"), "اضغط مرة ثانية لتأكيد الحذف", async () => {
    const { error } = await sb.from("tasks").delete().eq("id", id);
    if (error) return toast(friendly(error), 4000); toast("حُذف التمرين"); go("/m/class/" + t.class_id);
  });
});

route("/m/sub/:id", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainer")) return;
  const { data: s } = await sb.from("submissions").select("*, tasks(id,title,prompt,expected,class_id), profiles(full_name)").eq("id", id).single();
  if (!s) return shell("m", "/m", `<div class="card empty">التسليم غير موجود.</div>`);
  const { data: notes } = await sb.from("notes").select("body,created_at").eq("submission_id", id).order("created_at");
  const p = pct(s.typed_chars, s.pasted_chars);
  const mins = fmtMin(Math.round((new Date(s.submitted_at) - new Date(s.opened_at)) / 60000));
  const m = shell("m", "/m", `<div class="row"><a class="btn plain sm" href="#/m/task/${s.task_id}">→ التسليمات</a><h2 class="grow">تسليم: ${esc(s.profiles?.full_name || "متدرب")}</h2></div>
    <div class="stats"><span>⏱ وقت الحل <b>${mins}</b></span><span class="${p != null && p < 50 ? "bad" : ""}">⌨ كتابة يدوية <b>${p ?? "—"}%</b></span><span class="${s.pasted_chars ? "bad" : ""}">📋 ${s.pasted_chars ? `لصق <b>${s.pasted_chars}</b> حرف` : "بدون لصق"}</span>${s.in_session ? `<span>🎓 حُلّ أثناء المحاضرة</span>` : ""}${(notes || []).length ? `<span>📝 ${(notes || []).length} ملاحظة</span>` : ""}</div>
    <div class="ws review">
      <section class="pane"><h3>كود المتدرب</h3><div id="ws" class="pane"></div><p class="ai-note">هذا كود المتدرب كما سلّمه. التعديل هنا للتجربة فقط ولا يُحفظ.</p></section>
      <section class="pane">
        <div class="card"><b>${esc(s.tasks.title)}</b><p class="small">${esc(s.tasks.prompt)}</p><p class="tiny muted">المتوقع: ${esc(s.tasks.expected)}</p></div>
        ${s.ai_verdict ? `<div class="verdict ${s.ai_verdict}"><b>${VERDICT[s.ai_verdict][0]}</b><p class="small">${esc(s.ai_feedback || "")}</p><span class="tiny muted">${s.trainer_override ? "قرارك" : "اقتراح الذكاء الاصطناعي"}</span></div>` : `<div class="card small muted">لم يُقيَّم آليًا.</div>`}
        <div class="card"><b class="small">قرارك النهائي</b><div class="btns">${Object.entries(VERDICT).map(([k, [l]]) => `<button class="btn ${s.ai_verdict === k ? "" : "plain"} sm" data-v="${k}">${l}</button>`).join("")}</div></div>
        <form class="card" id="note"><b class="small">ملاحظة للمتدرب (باتجاه واحد، بدون محادثة)</b><textarea class="f" name="body" rows="3" maxlength="1000" required></textarea><button class="btn plain">إرسال الملاحظة</button></form>
        ${(notes || []).map((n) => `<div class="card small"><span class="tiny muted">${ago(n.created_at)}</span>${esc(n.body)}</div>`).join("")}
      </section>
    </div>`, "wide");
  const ws = mountWorkspace($("#ws", m), { code: s.code, big: true }); onLeave(() => ws.destroy());
  $$("[data-v]", m).forEach((b) => (b.onclick = async () => { const { error } = await sb.rpc("set_verdict", { p_sub: id, p_verdict: b.dataset.v }); toast(error ? friendly(error) : "تم اعتماد قرارك"); if (!error) render(); }));
  $("#note", m).onsubmit = async (e) => {
    e.preventDefault(); const body = new FormData(e.target).get("body").trim(); if (!body) return;
    const { error } = await sb.from("notes").insert({ submission_id: id, body }); toast(error ? friendly(error) : "أُرسلت الملاحظة"); if (!error) render();
  };
});

route("/m/class/:id/dash", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainer")) return;
  const [{ data: c }, { data: rows, error }, { data: tasks }] = await Promise.all([
    sb.from("classes").select("name").eq("id", id).single(),
    sb.rpc("class_metrics", { p_class: id }),
    sb.from("tasks").select("id,topic").eq("class_id", id),
  ]);
  const ids = (tasks || []).map((t) => t.id);
  const { data: errs } = ids.length ? await sb.from("error_events").select("message,user_id,task_id").in("task_id", ids).limit(2000) : { data: [] };
  // group errors: same kind of message (names replaced) counted once per trainee
  const norm = (m) => m.replace(/'[^']*'|"[^"]*"/g, "…").replace(/^(\w+) is not defined/, "X is not defined");
  const g = {}; for (const e of errs || []) { const k = norm(e.message); (g[k] ||= new Set()).add(e.user_id); }
  const common = Object.entries(g).filter(([k]) => !/^Script error/i.test(k)).map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const R = rows || [];
  const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const totalT = R.reduce((a, r) => a + r.tasks_total, 0), doneT = R.reduce((a, r) => a + r.tasks_done, 0);
  const m = shell("m", "/m", `<div class="row"><a class="btn plain sm" href="#/m/class/${id}">→ ${esc(c?.name || "الفصل")}</a><h2 class="grow">الالتزام والأداء</h2></div>
    ${error ? `<div class="card small">${esc(friendly(error))}</div>` : ""}
    <p class="small muted">مؤشرات قياس الأثر في المقترح، محسوبة من بيانات الاستخدام الفعلية:</p>
    <div class="kpis">
      <div class="kpi"><b>${avg(R.map((r) => r.typed_pct)) ?? "—"}%</b><span>نسبة الكتابة اليدوية</span></div>
      <div class="kpi"><b>${avg(R.map((r) => r.in_session_pct)) ?? "—"}%</b><span>المشاركة الصفية (حُلّت أثناء المحاضرة)</span></div>
      <div class="kpi"><b>${fmtMin(avg(R.map((r) => r.avg_minutes)))}</b><span>متوسط وقت إنجاز المهمة</span></div>
      <div class="kpi"><b>${totalT ? Math.round((doneT / totalT) * 100) : "—"}%</b><span>التمارين المسلّمة</span></div>
    </div>
    <div class="card"><h3>الأخطاء الشائعة</h3>${common.length ? common.map(([k, n]) => `<div class="row small"><code class="grow" style="text-align:end">${esc(k)}</code><span class="chip bad">${n} متدرب</span></div>`).join("") + `<p class="tiny muted">إذا تكرر الخطأ عند كثيرين، اشرحه للجميع من الشريحة.</p>` : `<p class="small muted">لا توجد أخطاء مسجّلة بعد.</p>`}</div>
    <div class="card scroll-x"><table class="t"><thead><tr><th>المتدرب</th><th>المسلّم</th><th>الكتابة اليدوية</th><th>وقت الحل</th><th>أثناء المحاضرة</th><th></th></tr></thead><tbody>
      ${R.map((r) => `<tr><td><b>${esc(r.full_name || "متدرب")}</b></td><td>${r.tasks_done}/${r.tasks_total}</td><td ${r.typed_pct != null && r.typed_pct < 50 ? 'style="color:var(--bad);font-weight:700"' : ""}>${r.typed_pct ?? "—"}%</td><td>${fmtMin(r.avg_minutes)}</td><td>${r.in_session_pct ?? "—"}%</td><td><button class="btn plain sm" data-rm="${r.user_id}">إزالة</button></td></tr>`).join("") || `<tr><td colspan="5" class="muted">لا يوجد متدربون بعد.</td></tr>`}
    </tbody></table></div>
    <p class="tiny muted">الأرقام للمتابعة والدعم وليست درجات. الدرجة الرسمية في منصة تقني، والقرار للمدرب.</p>`);
  // remove a trainee from the class (two taps, so it is never by mistake). Their past work stays saved.
  $$("[data-rm]", m).forEach((b) => (b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "تأكيد الإزالة"; b.classList.add("danger"); return; }
    const { error: e } = await sb.from("members").delete().eq("class_id", id).eq("user_id", b.dataset.rm);
    toast(e ? friendly(e) : "أُزيل المتدرب من الفصل"); if (!e) render();
  }));
});

// ---------- start ----------
// A reset link opens the app with "#access_token=...&type=recovery" (or "#error=..." if it expired).
const fromLink = START_HASH.includes("type=recovery") ? "/reset" : /[#&]error=/.test(START_HASH) ? "/login?e=link" : null;
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { me = null; } if (ev === "PASSWORD_RECOVERY") go("/reset"); });
window.addEventListener("hashchange", render);
if (fromLink) sb.auth.getSession().then(() => go(fromLink)); else render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
