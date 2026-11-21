// نوء — AI edge function. The Gemini key lives only here (Supabase secret GEMINI_API_KEY).
// No names, emails or ids are ever sent to Gemini: only lecture text, task text, code and error messages.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// "-latest" names always point to the current free models. Lite is fast and less busy; Flash is the backup.
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-lite-latest";
const FALLBACK = Deno.env.get("GEMINI_FALLBACK") ?? "gemini-flash-latest";
const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LIMIT_PER_HOUR = 80;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function gemini(system: string, user: string, schema: unknown) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is not set");
  // busy model (503/429): wait and retry, then fall back to the lighter free model
  let last = "";
  for (const [model, wait] of [[MODEL, 0], [FALLBACK, 0], [MODEL, 2000]] as const) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try { return await callGemini(model, system, user, schema); }
    catch (e) { last = String((e as Error).message); if (!/Gemini (503|429|500)|timed? ?out|abort/i.test(last)) throw e; }
  }
  throw new Error("الذكاء الاصطناعي مشغول الآن، جرّب بعد دقيقة. (" + last.slice(0, 60) + ")");
}

async function callGemini(model: string, system: string, user: string, schema: unknown, fast = true): Promise<any> {
  const generationConfig: Record<string, unknown> = { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4 };
  if (fast) generationConfig.thinkingConfig = { thinkingBudget: 0 }; // short answers, no long "thinking" = faster
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(30000), // don't hang: give up and try the other model
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig,
    }),
  });
  if (r.status === 400 && fast) return callGemini(model, system, user, schema, false); // model without that option
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  return JSON.parse(text);
}

const S = (props: Record<string, unknown>, req = Object.keys(props)) => ({ type: "OBJECT", properties: props, required: req });
const STR = { type: "STRING" };
const ARR = (items: unknown) => ({ type: "ARRAY", items });

const BASE = `أنت مساعد تعليمي في تطبيق «نَوء» لمتدربي البرمجة المبتدئين (HTML و CSS و JavaScript) في الكلية التقنية.
اكتب بالعربية الفصحى البسيطة، وبصيغة محايدة تناسب الجميع. لا تكتب الحل الكامل أبدًا. المدرب هو صاحب القرار.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "سجّل الدخول أولًا" }, 401);
    const admin = createClient(URL_, SERVICE);

    const body = await req.json();
    const action = String(body.action ?? "");

    // simple rate limit
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", since);
    if ((count ?? 0) >= LIMIT_PER_HOUR) return json({ error: "وصلت للحد المسموح من طلبات الذكاء في الساعة. حاول بعد قليل." }, 429);
    await admin.from("ai_usage").insert({ user_id: user.id, kind: action });

    // ---------- trainer: extract topics from lecture text ----------
    if (action === "topics") {
      const { data: lec } = await userClient.from("lectures").select("id,class_id").eq("id", body.lecture_id).single();
      if (!lec) return json({ error: "غير مسموح" }, 403);
      const { data: isT } = await userClient.from("classes").select("id").eq("id", lec.class_id).eq("trainer_id", user.id).maybeSingle();
      if (!isT) return json({ error: "للمدرب فقط" }, 403);
      const text = String(body.text ?? "").slice(0, 40000);
      const out = await gemini(BASE + "\nاستخرج المواضيع البرمجية القابلة للتطبيق العملي من نص المحاضرة.",
        `نص المحاضرة (كل صفحة تبدأ بـ [صفحة N]):\n${text}\n\nأعطني من 3 إلى 8 مواضيع. لكل موضوع: الاسم القصير (مثل: حلقة for)، وملخص سطر واحد، ورقم الصفحة.`,
        S({ topics: ARR(S({ topic: STR, summary: STR, page: { type: "INTEGER" } })) }));
      await userClient.from("lectures").update({ topics: out.topics }).eq("id", lec.id);
      return json(out);
    }

    // ---------- trainer: draft exercises for chosen topics ----------
    if (action === "tasks") {
      const { data: isT } = await userClient.from("classes").select("id").eq("id", body.class_id).eq("trainer_id", user.id).maybeSingle();
      if (!isT) return json({ error: "للمدرب فقط" }, 403);
      const topics = (body.topics ?? []).slice(0, 8).map((t: { topic: string; summary?: string }) => `- ${t.topic}: ${t.summary ?? ""}`).join("\n");
      const out = await gemini(BASE + "\nصمّم تمارين قصيرة تُحل في المتصفح بـ HTML و JavaScript وتظهر نتيجتها في المعاينة (داخل الصفحة أو عبر console.log). كود البداية يكون HTML كامل قصير، والجافاسكربت داخل وسم script. اكتب الكود على عدة أسطر (سطر لكل جملة) مع مسافات بادئة، ولا تضعه في سطر واحد.",
        `المواضيع:\n${topics}\n\nلكل موضوع تمرين واحد: عنوان قصير، ونص المطلوب (سطرين)، والناتج المتوقع والمفهوم المطلوب (للتقييم فقط)، وكود بداية قصير ناقص (ليس الحل).`,
        S({ tasks: ARR(S({ topic: STR, title: STR, prompt: STR, expected: STR, starter_code: STR })) }));
      return json(out);
    }

    // ---------- trainee: grade own submission (by output + concept, any correct way) ----------
    if (action === "grade") {
      const { data: sub } = await userClient.from("submissions").select("id,user_id,code,task_id,submitted_at").eq("id", body.submission_id).single();
      if (!sub || sub.user_id !== user.id || !sub.submitted_at) return json({ error: "غير مسموح" }, 403);
      const { data: task } = await userClient.from("tasks").select("title,prompt,expected,topic").eq("id", sub.task_id).single();
      const output = String(body.output_text ?? "").slice(0, 3000);
      const errors = String(body.errors ?? "").slice(0, 600);
      const out = await gemini(BASE + `\nقيّم حل المتدرب حسب الناتج والمفهوم المطلوب. اقبل أي طريقة صحيحة.
correct = الناتج صحيح والمفهوم مستخدم. partial = قريب لكن ينقصه شيء. wrong = لا يحقق المطلوب.
الملاحظة: سطران كحد أقصى، تمدح الصحيح وتلمّح للناقص بدون كتابة الحل.`,
        `التمرين: ${task?.title}\nالمطلوب: ${task?.prompt}\nالمفهوم: ${task?.topic}\nالمتوقع: ${task?.expected}\n\nكود المتدرب:\n${sub.code.slice(0, 8000)}\n\nما ظهر في المعاينة:\n${output}\n\nأخطاء التشغيل:\n${errors || "لا يوجد"}`,
        S({ verdict: { type: "STRING", enum: ["correct", "partial", "wrong"] }, feedback: STR }));
      await admin.from("submissions").update({ ai_verdict: out.verdict, ai_feedback: out.feedback, graded_at: new Date().toISOString() }).eq("id", sub.id);
      return json(out);
    }

    // ---------- trainee: explain an error in Arabic (keep English message), hint without solution ----------
    if (action === "hint") {
      const msg = String(body.message ?? "").slice(0, 300);
      const line = String(body.line_code ?? "").slice(0, 300);
      const out = await gemini(BASE + "\nاشرح رسالة الخطأ الإنجليزية للمبتدئ، ثم أعط تلميحًا واحدًا يوجّهه بدون كتابة الكود الصحيح.",
        `رسالة الخطأ: ${msg}\nالسطر: ${line}`, S({ explain: STR, hint: STR }));
      return json(out);
    }

    // ---------- trainee: ungraded practice quiz ----------
    if (action === "quiz") {
      const topic = String(body.topic ?? "").slice(0, 80);
      const out = await gemini(BASE + "\nاكتب اختبارًا تدريبيًا غير محتسب.",
        `الموضوع: ${topic}\n5 أسئلة اختيار من متعدد، 3 خيارات لكل سؤال، مع رقم الإجابة الصحيحة (0-2) وسطر شرح.`,
        S({ questions: ARR(S({ q: STR, options: ARR(STR), answer: { type: "INTEGER" }, why: STR })) }));
      return json(out);
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
