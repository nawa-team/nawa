import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// Read before the client clears it: a password-reset link arrives as "#access_token=...&type=recovery" or "#error=...".
export const START_HASH = location.hash;
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true } });

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function toast(msg, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast"; t.role = "status"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}

export function friendly(e) {
  const m = String(e?.message ?? e ?? "");
  if (/Invalid login credentials/i.test(m)) return "البريد أو كلمة المرور غير صحيحة";
  if (/already registered|already exists/i.test(m)) return "هذا البريد مسجّل مسبقًا";
  if (/Password should be/i.test(m)) return "كلمة المرور قصيرة (6 أحرف على الأقل)";
  if (/Email not confirmed/i.test(m)) return "فعّل بريدك من الرسالة التي وصلتك أولًا";
  if (/rate limit|For security purposes/i.test(m)) return "طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مرة أخرى";
  if (/should be different/i.test(m)) return "كلمة المرور الجديدة يجب أن تختلف عن القديمة";
  if (/Auth session missing/i.test(m)) return "انتهت صلاحية الرابط. اطلب رابطًا جديدًا";
  if (/Failed to fetch|NetworkError/i.test(m)) return "تعذّر الاتصال. تحقق من الإنترنت";
  if (/mime type|invalid_mime/i.test(m)) return "نوع الملف غير مسموح. ارفع ملف PDF فقط";
  if (/exceeded the maximum|too large|Payload too large/i.test(m)) return "الملف أكبر من الحد المسموح (15 ميجا)";
  if (/row-level security|permission denied|violates/i.test(m)) return "ليس لديك صلاحية لهذه العملية";
  return m.replace(/^.*?:\s*/, "") || "حدث خطأ غير متوقع";
}

export async function ai(action, payload) {
  const { data, error } = await sb.functions.invoke("ai", { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try { const b = await error.context.json(); if (b?.error) msg = b.error; } catch (_) {}
    if (/GEMINI_API_KEY is not set/.test(msg)) msg = "مفتاح الذكاء الاصطناعي غير مضاف بعد";
    throw new Error(msg);
  }
  return data;
}

export function fmtMin(m) { if (m == null) return "—"; if (m < 1) return "أقل من دقيقة"; if (m < 60) return `${m} د`;
  const h = Math.floor(m / 60), r = m % 60; return h >= 24 ? `${Math.round(h / 24)} يوم` : r ? `${h} س ${r} د` : `${h} س`; }
export function ago(ts) {
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60) return "الآن"; if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
  if (s < 86400) return `قبل ${Math.round(s / 3600)} س`; return new Date(ts).toLocaleDateString("ar-SA-u-nu-latn");
}

export const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 18 4 30 13 42M51 18 60 30 51 42" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 12C25 21 21 31 17 41H28Z" fill="#BCD13C"/><path d="M32 20V41H42C40 33 37 26 32 20Z" fill="#D35944"/><circle cx="43.5" cy="11" r="7" fill="#BCD13C" opacity=".35"/><circle cx="43.5" cy="11" r="4" fill="#BCD13C"/><path d="M12 52C17 48.5 22 48.5 27 52S37 55.5 42 52 47 48.5 52 52" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  home: P('<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  code: P('<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>'),
  bulb: P('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  class: P('<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/>'),
  chart: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  slides: P('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4M8 21h8"/>'),
};

// simple hash router
const routes = [];
export function route(pattern, handler, opts = {}) {
  const keys = []; const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ re, keys, handler, opts });
}
export function go(path) { if (location.hash !== "#" + path) location.hash = path; else render(); }
let cleanup = null;
export function onLeave(fn) { cleanup = fn; }
export async function render() {
  if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
  const path = location.hash.slice(1).split("?")[0] || "/";
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); return r.handler(params); }
  }
  go("/");
}
