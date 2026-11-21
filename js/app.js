import { sb, $, $$, esc, toast, friendly, ai, fmtMin, ago, LOGO, ICON, route, go, render, onLeave } from "./lib.js";
import { mountWorkspace } from "./workspace.js";
import { openPdf, renderPage, extractText } from "./pdf.js";

const app = $("#app");
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
  t: [["/t", "الرئيسية", "home"], ["/t/tasks", "التمارين", "code"], ["/t/practice", "التدريب", "bulb"], ["/t/me", "حسابي", "user"]],
  m: [["/m", "فصولي", "class"], ["/m/me", "حسابي", "user"]],
};
function shell(role, active, html, cls = "") {
  const nav = NAV[role];
  app.innerHTML = `
    <header class="top"><a class="brand" href="#${nav[0][0]}">${LOGO}<span>نَوء</span></a><span class="grow"></span>
      <nav>${nav.map(([h, l]) => `<a href="#${h}" ${h === active ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav></header>
    <main class="${cls}">${html}</main>
    <nav class="tabs">${nav.map(([h, l, i]) => `<a href="#${h}" ${h === active ? 'aria-current="page"' : ""}>${ICON[i]}${l}</a>`).join("")}</nav>`;
  return $("main", app);
}
const loading = () => (app.innerHTML = `<main class="narrow"><div class="empty"><span class="spinner"></span></div></main>`);
function need(role) {
  if (!me) { go("/login"); return false; }
  if (role && me.role !== role) { go(me.role === "trainer" ? "/m" : "/t"); return false; }
  return true;
}
const STATUS = { new: ["جديد", "new"], open: ["قيد الحل", ""], done: ["تم التسليم", "ok"] };
const VERDICT = { correct: ["صحيح", "ok"], partial: ["قريب", "new"], wrong: ["يحتاج مراجعة", "bad"] };
const vchip = (v) => (v ? `<span class="chip ${VERDICT[v][1]}">${VERDICT[v][0]}</span>` : "");
const pct = (a, b) => (a + b ? Math.round((a / (a + b)) * 100) : null);

// ---------- auth ----------
route("/", async () => { await loadMe(); go(!me ? "/welcome" : me.role === "trainer" ? "/m" : "/t"); });

route("/welcome", () => {
  app.innerHTML = `<main class="narrow">
    <div class="auth-hero">${LOGO}<b>نَوء</b><p class="muted">المحاضرة والكود في شاشة واحدة</p></div>
    <div class="card"><p class="small">شرائح المحاضرة ومحرر الكود والمعاينة الحية في مكان واحد. بدون تنقّل بين النوافذ، وبدون صور شاشة.</p></div>
    <a class="btn" href="#/login">تسجيل الدخول</a><a class="btn plain" href="#/signup">إنشاء حساب</a>
    <p class="tiny muted" style="text-align:center">نسخة تجريبية ببيانات تجريبية. يُستخدم الذكاء الاصطناعي للمساعدة، والقرار للمدرب.</p></main>`;
});

route("/login", () => {
  app.innerHTML = `<main class="narrow"><div class="auth-hero">${LOGO}<b>نَوء</b></div>
    <form class="card" id="f"><h2>تسجيل الدخول</h2>
      <label class="f">البريد الإلكتروني<input class="f" name="email" type="email" required autocomplete="email" dir="ltr"></label>
      <label class="f">كلمة المرور<input class="f" name="password" type="password" required autocomplete="current-password" dir="ltr"></label>
      <button class="btn">دخول</button><p class="tiny muted" id="msg"></p></form>
    <a class="btn plain" href="#/signup">ما عندي حساب</a></main>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const b = $("button", e.target); b.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.get("email").trim(), password: f.get("password") });
    b.disabled = false;
    if (error) return ($("#msg").textContent = friendly(error));
    await loadMe(); go("/");
  };
});

route("/signup", () => {
  let role = "trainee";
  app.innerHTML = `<main class="narrow"><div class="auth-hero">${LOGO}<b>نَوء</b></div>
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
  const { data } = await sb.from("members").select("class_id, classes(id,name,code,live_slide,trainer_id)").eq("user_id", me.id);
  return (data || []).map((r) => r.classes).filter(Boolean);
}
function currentClass(list) {
  const saved = localStorage.getItem("nawa.class");
  return list.find((c) => c.id === saved) || list[0];
}

route("/t/join", async () => {
  await loadMe(); if (!need("trainee")) return;
  const m = shell("t", "/t", `<div class="card"><h2>الانضمام لفصل</h2><p class="small muted">اكتب الرمز اللي يعرضه المدرب (6 خانات).</p>
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
    sb.from("tasks").select("id,title,topic,is_extra,target_user,lecture_id,created_at").eq("class_id", cls.id).order("created_at", { ascending: false }),
    sb.from("submissions").select("task_id,submitted_at,ai_verdict").eq("user_id", me.id),
  ]);
  const sm = Object.fromEntries((subs || []).map((s) => [s.task_id, s]));
  return (tasks || []).map((t) => ({ ...t, sub: sm[t.id], st: !sm[t.id] ? "new" : sm[t.id].submitted_at ? "done" : "open" }));
}
const taskRow = (t) => `<a href="#/t/task/${t.id}"><div class="grow"><div class="t">${esc(t.title)}</div><div class="tiny muted">${esc(t.topic)}${t.target_user ? " · مُرسل لك" : ""}${t.is_extra ? " · إضافي" : ""}</div></div>
  <span class="chip ${STATUS[t.st][1]}">${STATUS[t.st][0]}</span>${t.sub ? vchip(t.sub.ai_verdict) : ""}</a>`;

route("/t", async () => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const list = await myClasses(); if (!list.length) return go("/t/join");
  const cls = currentClass(list);
  const tasks = await loadTasksWithStatus(cls);
  const { data: lecs } = await sb.from("lectures").select("id,title,created_at").eq("class_id", cls.id).order("created_at", { ascending: false }).limit(3);
  const todo = tasks.filter((t) => t.st !== "done");
  const m = shell("t", "/t", `
    <div class="row"><div class="grow"><h1>أهلًا، ${esc(me.full_name || "")}</h1><p class="small muted">${esc(cls.name)}</p></div>
      ${list.length > 1 ? `<select class="f" id="cls" style="width:auto">${list.map((c) => `<option value="${c.id}" ${c.id === cls.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : ""}</div>
    <div class="card" id="live">${cls.live_slide ? `<span class="chip live" style="align-self:flex-start"><span class="dot"></span> الجلسة مباشرة الآن</span><p class="small">المدرب على الشريحة ${cls.live_slide}. افتح المحاضرة وتابع معه.</p>${lecs?.[0] ? `<a class="btn live" href="#/t/lecture/${lecs[0].id}">فتح المحاضرة</a>` : ""}` : `<span class="chip" style="align-self:flex-start">لا توجد جلسة الآن</span><p class="small muted">عند بدء الجلسة يظهر تنبيه هنا.</p>`}</div>
    <h3>المطلوب منك</h3>
    <div class="list">${todo.length ? todo.map(taskRow).join("") : `<div class="empty">ما عندك تمارين مفتوحة 👏</div>`}</div>
    ${lecs?.length ? `<h3>المحاضرات</h3><div class="list">${lecs.map((l) => `<a href="#/t/lecture/${l.id}">${ICON.slides}<div class="grow t">${esc(l.title)}</div><span class="tiny muted">${ago(l.created_at)}</span></a>`).join("")}</div>` : ""}`);
  const sel = $("#cls", m); if (sel) sel.onchange = () => { localStorage.setItem("nawa.class", sel.value); render(); };
  const ch = sb.channel("cls-" + cls.id).on("postgres_changes", { event: "UPDATE", schema: "public", table: "classes", filter: `id=eq.${cls.id}` }, () => render()).subscribe();
  onLeave(() => sb.removeChannel(ch));
});

route("/t/tasks", async () => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const list = await myClasses(); if (!list.length) return go("/t/join");
  const tasks = await loadTasksWithStatus(currentClass(list));
  const topics = [...new Set(tasks.map((t) => t.topic))];
  shell("t", "/t/tasks", `<h1>التمارين</h1>${topics.length ? topics.map((tp) => `<h3>${esc(tp)}</h3><div class="list">${tasks.filter((t) => t.topic === tp).map(taskRow).join("")}</div>`).join("") : `<div class="card empty">ما وصلتك تمارين بعد.</div>`}`);
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
    <div class="row"><a class="btn plain sm" href="#/t/tasks">→ التمارين</a><h2 class="grow">${esc(task.title)}</h2>${sub.submitted_at ? vchip(sub.ai_verdict) : ""}</div>
    <div class="ws">
      <section class="pane">
        <div class="card"><span class="chip new" style="align-self:flex-start">${esc(task.topic)}</span><p>${esc(task.prompt)}</p></div>
        ${lec?.file_path ? `<div class="card"><div class="row"><b class="grow small">${esc(lec.title)}</b><span class="tiny muted" id="pg"></span></div><div class="slidebox"><canvas id="cv"></canvas></div>
          <div class="slidenav"><button class="btn plain sm" id="prev">›</button><span class="grow"></span><button class="btn plain sm" id="next">‹</button></div></div>` : ""}
        <div id="result">${resultHTML(sub)}</div>
        ${(notes || []).map((n) => `<div class="card"><span class="tiny muted">ملاحظة من المدرب · ${ago(n.created_at)}</span><p class="small">${esc(n.body)}</p></div>`).join("")}
      </section>
      <section class="pane"><div id="ws" class="pane"></div>
        <div class="row"><button class="btn grow" id="submit">${sub.submitted_at ? "إعادة التسليم" : "تسليم"}</button></div>
        <p class="ai-note">يُقيَّم الحل بالذكاء الاصطناعي حسب الناتج والمفهوم، وأي طريقة صحيحة مقبولة. القرار النهائي للمدرب.</p></section>
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

  if (lec?.file_path) mountSlides(m, lec.file_path, 1);

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
      $("#result", m).innerHTML = `<div class="card"><span class="chip ok" style="align-self:flex-start">تم التسليم</span><p class="small muted">التقييم الآلي غير متاح الآن (${esc(er.message)}). المدرب يشوف حلّك.</p></div>`;
    }
    b.disabled = false; b.textContent = "إعادة التسليم";
  };
});
function resultHTML(s) {
  if (!s.submitted_at) return "";
  const p = pct(s.typed_chars, s.pasted_chars);
  if (!s.ai_verdict) return `<div class="card"><span class="chip ok" style="align-self:flex-start">تم التسليم</span><span class="tiny muted">الكتابة اليدوية: ${p ?? "—"}%</span></div>`;
  return `<div class="verdict ${s.ai_verdict}"><b>${VERDICT[s.ai_verdict][0]}</b>${s.ai_feedback ? `<p class="small">${esc(s.ai_feedback)}</p>` : ""}
    <span class="tiny muted">الكتابة اليدوية: ${p ?? "—"}% · ${s.trainer_override ? "قرار المدرب" : "تقييم الذكاء الاصطناعي، والقرار للمدرب"}</span></div>`;
}

// slides viewer (shared). follow = realtime class slide for trainees; onPage = trainer sets live slide
async function mountSlides(root, path, start = 1, { onPage, follow } = {}) {
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
  };
  $("#prev", root).onclick = () => { if (follow) follow.off(); show(page - 1); };
  $("#next", root).onclick = () => { if (follow) follow.off(); show(page + 1); };
  await show(page, true);
  return { show, get doc() { return doc; }, get page() { return page; } };
}

route("/t/lecture/:id", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const { data: lec } = await sb.from("lectures").select("*, classes(id,live_slide)").eq("id", id).single();
  if (!lec) return shell("t", "/t", `<div class="card empty">المحاضرة غير متاحة.</div>`);
  const { data: tasks } = await sb.from("tasks").select("id,title,topic").eq("lecture_id", id);
  let following = !!lec.classes?.live_slide;
  const m = shell("t", "/t", `
    <div class="row"><h2 class="grow">${esc(lec.title)}</h2>${lec.classes?.live_slide ? `<span class="chip live"><span class="dot"></span> مباشر</span>` : ""}
      <button class="switch" id="follow" aria-pressed="${following}"><i></i>متابعة شريحة المدرب</button></div>
    <div class="ws">
      <section class="pane"><div class="slidebox"><canvas id="cv"></canvas></div>
        <div class="slidenav"><button class="btn plain sm" id="prev">›</button><span class="grow small muted" id="pg" style="text-align:center"></span><button class="btn plain sm" id="next">‹</button></div>
        ${tasks?.length ? `<h3>تمارين هذه المحاضرة</h3><div class="list">${tasks.map((t) => `<a href="#/t/task/${t.id}"><div class="grow t">${esc(t.title)}</div><span class="chip new">${esc(t.topic)}</span></a>`).join("")}</div>` : ""}</section>
      <section class="pane"><h3>جرّب أمثلة المحاضرة هنا</h3><div id="ws" class="pane"></div><p class="ai-note">مساحة تجربة حرة، لا تُحفظ ولا تُقيَّم.</p></section>
    </div>`, "wide");
  const ws = mountWorkspace($("#ws", m), { code: "<h1>مرحبا</h1>\n<script>\n  \n<\/script>" });
  const fbtn = $("#follow", m);
  const follow = { off() { following = false; fbtn.setAttribute("aria-pressed", "false"); } };
  let sl; mountSlides(m, lec.file_path, lec.classes?.live_slide || 1, { follow }).then((x) => (sl = x));
  fbtn.onclick = async () => {
    following = !following; fbtn.setAttribute("aria-pressed", following);
    if (following) { const { data } = await sb.from("classes").select("live_slide").eq("id", lec.class_id).single(); if (data?.live_slide && sl) sl.show(data.live_slide, true); }
  };
  const ch = sb.channel("live-" + lec.class_id).on("postgres_changes", { event: "UPDATE", schema: "public", table: "classes", filter: `id=eq.${lec.class_id}` },
    (p) => { if (following && p.new.live_slide && sl) sl.show(p.new.live_slide, true); }).subscribe();
  onLeave(() => { sb.removeChannel(ch); ws.destroy(); });
});

route("/t/practice", async () => {
  loading(); await loadMe(); if (!need("trainee")) return;
  const list = await myClasses(); if (!list.length) return go("/t/join");
  const tasks = await loadTasksWithStatus(currentClass(list));
  const topics = [...new Set(tasks.map((t) => t.topic))];
  const m = shell("t", "/t/practice", `<h1>التدريب</h1><p class="small muted">اختبارات قصيرة بدون درجة، يولّدها الذكاء الاصطناعي من مواضيع فصلك.</p>
    <div class="btns" id="topics">${topics.length ? topics.map((t) => `<button class="btn ghost" data-t="${esc(t)}">${esc(t)}</button>`).join("") : `<span class="muted small">تظهر المواضيع بعد ما يرسل المدرب تمارين.</span>`}</div>
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
      <div class="card small"><b>خصوصيتك</b><p class="muted">لا نرسل اسمك أو بريدك للذكاء الاصطناعي، فقط نص التمرين والكود ورسالة الخطأ. المدرب يشوف فصله فقط.</p></div>
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
  const { data: classes } = await sb.from("classes").select("id,name,code,live_slide,created_at").eq("trainer_id", me.id).order("created_at");
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
    sb.from("lectures").select("id,title,created_at").eq("class_id", id).order("created_at", { ascending: false }),
    sb.from("tasks").select("id,title,topic,target_user,created_at,submissions(submitted_at)").eq("class_id", id).order("created_at", { ascending: false }),
    sb.from("members").select("user_id", { count: "exact", head: true }).eq("class_id", id),
  ]);
  if (!c) return shell("m", "/m", `<div class="card empty">الفصل غير موجود.</div>`);
  const m = shell("m", "/m", `
    <div class="row"><a class="btn plain sm" href="#/m">→ فصولي</a><h1 class="grow">${esc(c.name)}</h1>
      ${c.live_slide ? `<span class="chip live"><span class="dot"></span> الجلسة مباشرة</span><button class="btn plain sm" id="end">إنهاء الجلسة</button>` : ""}</div>
    <div class="grid">
      <div class="card" style="text-align:center"><span class="small muted">رمز الفصل للعرض على الشاشة</span><div class="big-code">${c.code}</div><span class="small muted">${nMem ?? 0} متدرب في الفصل</span><button class="btn plain sm" id="copy">نسخ الرمز</button></div>
      <div class="card"><h3>المتابعة</h3><a class="btn" href="#/m/class/${id}/dash">${ICON.chart} لوحة الالتزام والأخطاء الشائعة</a>
        <p class="small muted">من أنجز، ونسبة الكتابة اليدوية، ووقت الحل، والأخطاء المتكررة.</p></div>
    </div>
    <h3>المحاضرات</h3>
    <div class="list">${lecs?.length ? lecs.map((l) => `<a href="#/m/lecture/${l.id}">${ICON.slides}<div class="grow t">${esc(l.title)}</div><span class="tiny muted">${ago(l.created_at)}</span></a>`).join("") : `<div class="empty">ارفع أول محاضرة (PDF).</div>`}</div>
    <form class="card" id="up"><h3>رفع محاضرة</h3>
      <label class="f">العنوان<input class="f" name="title" required maxlength="100" placeholder="المحاضرة 3: الحلقات"></label>
      <label class="f">ملف PDF (حتى 15 ميجا)<input class="f" name="file" type="file" accept="application/pdf" required></label>
      <button class="btn">رفع</button><p class="tiny muted" id="upmsg"></p></form>
    <h3>التمارين المرسلة</h3>
    <div class="list">${tasks?.length ? tasks.map((t) => { const done = (t.submissions || []).filter((s) => s.submitted_at).length;
      return `<a href="#/m/task/${t.id}"><div class="grow"><div class="t">${esc(t.title)}</div><div class="tiny muted">${esc(t.topic)}${t.target_user ? " · لمتدرب محدد" : ""}</div></div><span class="small">${done}/${t.target_user ? 1 : nMem ?? 0}</span></a>`; }).join("") : `<div class="empty">بعد رفع المحاضرة، اختر المواضيع ونرسل التمارين.</div>`}</div>
    <details class="card"><summary><b>إضافة تمرين يدوي</b></summary>${taskForm()}</details>`, "");
  $("#copy", m).onclick = () => { navigator.clipboard?.writeText(c.code); toast("تم نسخ الرمز"); };
  const end = $("#end", m); if (end) end.onclick = async () => { await sb.from("classes").update({ live_slide: null }).eq("id", id); render(); };
  $("#up", m).onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const file = f.get("file"); const b = $("button", e.target);
    if (file.type !== "application/pdf") return ($("#upmsg").textContent = "الملف لازم يكون PDF");
    if (file.size > 15 * 1024 * 1024) return ($("#upmsg").textContent = "الملف أكبر من 15 ميجا");
    b.disabled = true; b.innerHTML = '<span class="spinner"></span> جارٍ الرفع';
    const path = `${id}/${crypto.randomUUID()}.pdf`;
    const { error } = await sb.storage.from("lectures").upload(path, file, { contentType: "application/pdf" });
    if (error) { b.disabled = false; b.textContent = "رفع"; return ($("#upmsg").textContent = friendly(error)); }
    const { data: lec, error: e2 } = await sb.from("lectures").insert({ class_id: id, title: f.get("title").trim(), file_path: path }).select().single();
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
    ${i === "" ? `<button class="btn" data-send-one>إرسال للفصل كاملًا</button>` : ""}</div>`;
}
function readTask(el) { const g = (n) => $(`[name="${n}"]`, el).value.trim(); return { topic: g("topic"), title: g("title"), prompt: g("prompt"), expected: g("expected"), starter_code: $(`[name="starter_code"]`, el).value }; }
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
  const { data: lec } = await sb.from("lectures").select("*, classes(id,name,live_slide)").eq("id", id).single();
  if (!lec) return shell("m", "/m", `<div class="card empty">المحاضرة غير موجودة.</div>`);
  const { data: members } = await sb.from("members").select("user_id, profiles(full_name)").eq("class_id", lec.class_id);
  const live = !!lec.classes.live_slide;
  const m = shell("m", "/m", `
    <div class="row"><a class="btn plain sm" href="#/m/class/${lec.class_id}">→ ${esc(lec.classes.name)}</a><h2 class="grow">${esc(lec.title)}</h2>
      <button class="btn ${live ? "plain" : "live"} sm" id="live">${live ? "إنهاء الجلسة" : "بدء الجلسة المباشرة"}</button></div>
    <div class="ws">
      <section class="pane"><div class="slidebox"><canvas id="cv"></canvas></div>
        <div class="slidenav"><button class="btn plain sm" id="prev">›</button><span class="grow small muted" id="pg" style="text-align:center"></span><button class="btn plain sm" id="next">‹</button></div>
        <p class="tiny muted" id="livehint">${live ? "المتدربون اللي فعّلوا «متابعة شريحة المدرب» يتنقلون معك." : "ابدأ الجلسة عشان المتدربين يتابعون الشريحة معك."}</p></section>
      <section class="pane">
        <div class="card"><div class="row"><h3 class="grow">المواضيع</h3><button class="btn ghost sm" id="extract">${lec.topics?.length ? "إعادة الاستخراج" : "استخراج المواضيع بالذكاء"}</button></div>
          <div id="topics">${topicsHTML(lec.topics)}</div>
          <button class="btn" id="gen" ${lec.topics?.length ? "" : "hidden"}>توليد تمارين للمواضيع المختارة</button>
          <p class="ai-note">المواضيع والتمارين اقتراحات من الذكاء الاصطناعي. أنت تراجعها وتعدّلها وتقرر ترسلها أو لا.</p></div>
        <div id="drafts"></div>
      </section>
    </div>`, "wide");
  let sl;
  const setLive = async (n) => { if (live) await sb.from("classes").update({ live_slide: n }).eq("id", lec.class_id); };
  const slReady = mountSlides(m, lec.file_path, lec.classes.live_slide || 1, { onPage: setLive }).then((x) => (sl = x)); // buttons work while the PDF loads
  $("#live", m).onclick = async () => {
    await sb.from("classes").update({ live_slide: live ? null : sl?.page || 1 }).eq("id", lec.class_id);
    toast(live ? "انتهت الجلسة" : "بدأت الجلسة، والمتدربون يشوفون التنبيه"); render();
  };
  const doExtract = async () => {
    const b = $("#extract", m); b.disabled = true; b.innerHTML = '<span class="spinner"></span> يقرأ المحاضرة';
    try {
      await slReady; if (!sl) throw new Error("تعذّر فتح ملف المحاضرة");
      const text = await extractText(sl.doc);
      if (text.replace(/\[صفحة \d+\]|\s/g, "").length < 40) throw new Error("ما قدرنا نقرأ نص من الملف (يمكن صور فقط). أضف التمارين يدويًا.");
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
      $("#drafts", m).innerHTML = `<div class="card"><h3>مسودات التمارين</h3><p class="small muted">راجع وعدّل، ثم اختر لمن ترسل.</p>
        ${tasks.map((t, i) => `<div class="card" style="background:var(--sunk)"><label class="row small"><input type="checkbox" checked data-pick="${i}"> إرسال هذا التمرين</label>${taskForm(t, i)}</div>`).join("")}
        <div class="seg" role="group"><button type="button" data-to="all" aria-pressed="true">الفصل كاملًا</button><button type="button" data-to="one" aria-pressed="false">متدرب محدد</button></div>
        <select class="f" id="who" hidden>${(members || []).map((x) => `<option value="${x.user_id}">${esc(x.profiles?.full_name || "متدرب")}</option>`).join("")}</select>
        <button class="btn" id="send">إرسال</button></div>`;
      let to = "all";
      $$("[data-to]", m).forEach((x) => (x.onclick = () => { to = x.dataset.to; $$("[data-to]", m).forEach((y) => y.setAttribute("aria-pressed", y === x)); $("#who", m).hidden = to !== "one"; }));
      $("#send", m).onclick = async () => {
        const rows = $$("[data-pick]:checked", m).map((x) => ({ ...readTask($(`[data-task="${x.dataset.pick}"]`, m)), class_id: lec.class_id, lecture_id: id, target_user: to === "one" ? $("#who", m).value : null }));
        if (!rows.length) return toast("اختر تمرينًا واحدًا على الأقل");
        if (to === "one" && !$("#who", m).value) return toast("ما فيه متدربين في الفصل بعد");
        const { error } = await sb.from("tasks").insert(rows);
        if (error) return toast(friendly(error));
        toast(`أُرسل ${rows.length} تمرين`); go("/m/class/" + lec.class_id);
      };
    } catch (er) { toast(er.message, 4000); }
    b.disabled = false; b.textContent = "توليد تمارين للمواضيع المختارة";
  };
});
const topicsHTML = (ts) => ts?.length ? ts.map((t, i) => `<label class="row small" style="align-items:flex-start"><input type="checkbox" value="${i}" checked style="margin-top:5px"><span class="grow"><b>${esc(t.topic)}</b> <span class="tiny muted">ص ${t.page ?? "—"}</span><br><span class="muted">${esc(t.summary)}</span></span></label>`).join("") : `<p class="small muted">ما استُخرجت مواضيع بعد.</p>`;

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
    <div class="list">${rows.length ? rows.map(({ name, s }) => {
      const p = s ? pct(s.typed_chars, s.pasted_chars) : null;
      const inner = `<div class="grow"><div class="t">${esc(name)}</div><div class="tiny muted">${!s ? "لم يفتح التمرين" : s.submitted_at ? `كتابة يدوية ${p ?? "—"}% · وقت الحل ${fmtMin(Math.round((new Date(s.submitted_at) - new Date(s.opened_at)) / 60000))}${s.pasted_chars ? " · يوجد لصق" : ""}` : "قيد الحل الآن"}</div></div>
        ${s?.submitted_at ? vchip(s.ai_verdict) || `<span class="chip ok">تم التسليم</span>` : `<span class="chip">${s ? "قيد الحل" : "لم يبدأ"}</span>`}`;
      return s?.submitted_at ? `<a href="#/m/sub/${s.id}">${inner}</a>` : `<div>${inner}</div>`; }).join("") : `<div class="empty">ما فيه متدربين في الفصل بعد.</div>`}</div>`, "narrow");
});

route("/m/sub/:id", async ({ id }) => {
  loading(); await loadMe(); if (!need("trainer")) return;
  const { data: s } = await sb.from("submissions").select("*, tasks(id,title,prompt,expected,class_id), profiles(full_name)").eq("id", id).single();
  if (!s) return shell("m", "/m", `<div class="card empty">التسليم غير موجود.</div>`);
  const { data: notes } = await sb.from("notes").select("body,created_at").eq("submission_id", id).order("created_at");
  const p = pct(s.typed_chars, s.pasted_chars);
  const m = shell("m", "/m", `<div class="row"><a class="btn plain sm" href="#/m/task/${s.task_id}">→ التسليمات</a><h2 class="grow">تسليم: ${esc(s.profiles?.full_name || "متدرب")}</h2></div>
    <div class="ws">
      <section class="pane">
        <div class="card"><b>${esc(s.tasks.title)}</b><p class="small">${esc(s.tasks.prompt)}</p><p class="tiny muted">المتوقع: ${esc(s.tasks.expected)}</p></div>
        <div class="kpis"><div class="kpi"><b>${p ?? "—"}%</b><span>كتابة يدوية</span></div><div class="kpi"><b>${fmtMin(Math.round((new Date(s.submitted_at) - new Date(s.opened_at)) / 60000))}</b><span>وقت الحل</span></div></div>
        ${s.ai_verdict ? `<div class="verdict ${s.ai_verdict}"><b>${VERDICT[s.ai_verdict][0]}</b><p class="small">${esc(s.ai_feedback || "")}</p><span class="tiny muted">${s.trainer_override ? "قرارك" : "اقتراح الذكاء الاصطناعي"}</span></div>` : `<div class="card small muted">لم يُقيَّم آليًا.</div>`}
        <div class="card"><b class="small">قرارك النهائي</b><div class="btns">${Object.entries(VERDICT).map(([k, [l]]) => `<button class="btn ${s.ai_verdict === k ? "" : "plain"} sm" data-v="${k}">${l}</button>`).join("")}</div></div>
        <form class="card" id="note"><b class="small">ملاحظة للمتدرب (باتجاه واحد، بدون محادثة)</b><textarea class="f" name="body" rows="3" maxlength="1000" required></textarea><button class="btn plain">إرسال الملاحظة</button></form>
        ${(notes || []).map((n) => `<div class="card small"><span class="tiny muted">${ago(n.created_at)}</span>${esc(n.body)}</div>`).join("")}
      </section>
      <section class="pane"><div id="ws" class="pane"></div><p class="ai-note">هذا كود المتدرب كما سلّمه. التعديل هنا للتجربة فقط ولا يُحفظ.</p></section>
    </div>`, "wide");
  const ws = mountWorkspace($("#ws", m), { code: s.code }); onLeave(() => ws.destroy());
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
  const common = Object.entries(g).map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const R = rows || [];
  const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const totalT = R.reduce((a, r) => a + r.tasks_total, 0), doneT = R.reduce((a, r) => a + r.tasks_done, 0);
  shell("m", "/m", `<div class="row"><a class="btn plain sm" href="#/m/class/${id}">→ ${esc(c?.name || "الفصل")}</a><h2 class="grow">الالتزام والأداء</h2></div>
    ${error ? `<div class="card small">${esc(friendly(error))}</div>` : ""}
    <p class="small muted">مؤشرات قياس الأثر في المقترح، محسوبة من بيانات الاستخدام الفعلية:</p>
    <div class="kpis">
      <div class="kpi"><b>${avg(R.map((r) => r.typed_pct)) ?? "—"}%</b><span>نسبة الكتابة اليدوية</span></div>
      <div class="kpi"><b>${avg(R.map((r) => r.in_session_pct)) ?? "—"}%</b><span>المشاركة الصفية (حُلّت أثناء المحاضرة)</span></div>
      <div class="kpi"><b>${fmtMin(avg(R.map((r) => r.avg_minutes)))}</b><span>متوسط وقت إنجاز المهمة</span></div>
      <div class="kpi"><b>${totalT ? Math.round((doneT / totalT) * 100) : "—"}%</b><span>التمارين المسلّمة</span></div>
    </div>
    <div class="card"><h3>الأخطاء الشائعة</h3>${common.length ? common.map(([k, n]) => `<div class="row small"><code class="grow" style="text-align:end">${esc(k)}</code><span class="chip bad">${n} متدرب</span></div>`).join("") + `<p class="tiny muted">إذا تكرر الخطأ عند كثيرين، اشرحه للجميع من الشريحة.</p>` : `<p class="small muted">ما فيه أخطاء مسجلة بعد.</p>`}</div>
    <div class="card scroll-x"><table class="t"><thead><tr><th>المتدرب</th><th>المسلّم</th><th>الكتابة اليدوية</th><th>وقت الحل</th><th>أثناء المحاضرة</th></tr></thead><tbody>
      ${R.map((r) => `<tr><td><b>${esc(r.full_name || "متدرب")}</b></td><td>${r.tasks_done}/${r.tasks_total}</td><td ${r.typed_pct != null && r.typed_pct < 50 ? 'style="color:var(--bad);font-weight:700"' : ""}>${r.typed_pct ?? "—"}%</td><td>${fmtMin(r.avg_minutes)}</td><td>${r.in_session_pct ?? "—"}%</td></tr>`).join("") || `<tr><td colspan="5" class="muted">ما فيه متدربين بعد.</td></tr>`}
    </tbody></table></div>
    <p class="tiny muted">الأرقام للمتابعة والدعم وليست درجات. الدرجة الرسمية في منصة تقني، والقرار للمدرب.</p>`);
});

// ---------- start ----------
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { me = null; } });
window.addEventListener("hashchange", render);
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
