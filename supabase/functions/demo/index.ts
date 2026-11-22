// نوء — "Quick try" for judges and visitors: signs into a FAKE demo account without any password.
// The server creates a one-time sign-in token for one of two fixed demo accounts; nothing secret reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const DEMO: Record<string, string> = {
  trainer: "trainer.demo@nawa.dev",
  trainee: "trainee1.demo@nawa.dev",
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { role } = await req.json();
    const email = DEMO[String(role)];
    if (!email) return json({ error: "نوع الحساب غير معروف" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // magic-link token, used once by the browser right away (no email is sent)
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    return json({ token_hash: data.properties.hashed_token });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e).slice(0, 200) }, 500);
  }
});
