-- Saved AI answers: the same question gets the saved answer instead of a new Gemini call.
-- Only the server function (service role) reads and writes it: RLS on, no policies.
create table if not exists public.ai_cache (
  key text primary key,          -- sha-256 of the instructions + the text sent
  value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.ai_cache enable row level security;
revoke all on public.ai_cache from anon, authenticated;
