-- نوء: schema + row level security
-- Every table has RLS on. Roles: trainee (default) / trainer (only via become_trainer RPC).

create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table private.settings (key text primary key, value text not null);
-- the real trainer code is set directly in the database, never in this repo:
-- update private.settings set value = '<secret>' where key = 'trainer_code';
insert into private.settings values ('trainer_code', md5(random()::text));

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'trainee' check (role in ('trainee','trainer')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(left(new.raw_user_meta_data->>'full_name', 60), ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- classes / members ----------
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  code text not null unique,
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  live_slide int,                       -- current slide when a session is live (null = no session)
  created_at timestamptz not null default now()
);
alter table public.classes enable row level security;

create table public.members (
  class_id uuid references public.classes(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);
alter table public.members enable row level security;

-- helper checks (security definer so policies don't recurse)
create function private.is_trainer_of(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes where id = c and trainer_id = auth.uid());
$$;
create function private.is_member_of(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where class_id = c and user_id = auth.uid());
$$;
create function private.is_trainer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'trainer');
$$;
grant usage on schema private to authenticated;
grant execute on function private.is_trainer_of(uuid), private.is_member_of(uuid), private.is_trainer() to authenticated;

-- ---------- lectures / tasks ----------
create table public.lectures (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null,
  file_path text,                       -- storage path in bucket "lectures"
  topics jsonb not null default '[]',   -- [{topic, summary, page}]
  created_at timestamptz not null default now()
);
alter table public.lectures enable row level security;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  lecture_id uuid references public.lectures(id) on delete set null,
  topic text not null,
  title text not null,
  prompt text not null,                 -- what the trainee must build
  expected text not null default '',    -- expected output / concept, used by AI grading
  starter_code text not null default '',
  target_user uuid references public.profiles(id) on delete cascade,  -- null = whole class
  is_extra boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.tasks enable row level security;

-- ---------- submissions (one row per trainee per task) ----------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  code text not null default '',
  typed_chars int not null default 0 check (typed_chars >= 0),
  pasted_chars int not null default 0 check (pasted_chars >= 0),
  opened_at timestamptz not null default now(),
  submitted_at timestamptz,
  in_session boolean not null default false,   -- solved while the class session was live
  -- set ONLY by the AI edge function (service role):
  ai_verdict text check (ai_verdict in ('correct','partial','wrong')),
  ai_feedback text,
  graded_at timestamptz,
  unique (task_id, user_id)
);
alter table public.submissions enable row level security;

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.notes enable row level security;

create table public.error_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  message text not null check (length(message) <= 300),
  created_at timestamptz not null default now()
);
alter table public.error_events enable row level security;

-- ---------- policies ----------
-- profiles: see yourself, trainers see members of their classes, members see their trainer's name
create policy "profiles self read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles trainer reads members" on public.profiles for select to authenticated
  using (exists (select 1 from public.members m where m.user_id = profiles.id and private.is_trainer_of(m.class_id)));
create policy "profiles members read trainer" on public.profiles for select to authenticated
  using (exists (select 1 from public.classes c where c.trainer_id = profiles.id and private.is_member_of(c.id)));
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;   -- role can never be changed from the app

-- classes
create policy "classes read" on public.classes for select to authenticated
  using (trainer_id = auth.uid() or private.is_member_of(id));
create policy "classes create by trainer" on public.classes for insert to authenticated
  with check (trainer_id = auth.uid() and private.is_trainer());
create policy "classes update own" on public.classes for update to authenticated
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
create policy "classes delete own" on public.classes for delete to authenticated using (trainer_id = auth.uid());

-- members: joining happens only through join_class(); read self or own class
create policy "members read" on public.members for select to authenticated
  using (user_id = auth.uid() or private.is_trainer_of(class_id));
create policy "members leave" on public.members for delete to authenticated
  using (user_id = auth.uid() or private.is_trainer_of(class_id));

-- lectures
create policy "lectures read" on public.lectures for select to authenticated
  using (private.is_trainer_of(class_id) or private.is_member_of(class_id));
create policy "lectures write" on public.lectures for all to authenticated
  using (private.is_trainer_of(class_id)) with check (private.is_trainer_of(class_id));

-- tasks: trainee sees class-wide tasks and tasks sent to them only
create policy "tasks read" on public.tasks for select to authenticated
  using (private.is_trainer_of(class_id)
     or (private.is_member_of(class_id) and (target_user is null or target_user = auth.uid())));
create policy "tasks write" on public.tasks for all to authenticated
  using (private.is_trainer_of(class_id)) with check (private.is_trainer_of(class_id));

-- submissions
create policy "subs read" on public.submissions for select to authenticated
  using (user_id = auth.uid()
     or exists (select 1 from public.tasks t where t.id = task_id and private.is_trainer_of(t.class_id)));
create policy "subs insert own" on public.submissions for insert to authenticated
  with check (user_id = auth.uid()
     and exists (select 1 from public.tasks t where t.id = task_id and private.is_member_of(t.class_id)
                 and (t.target_user is null or t.target_user = auth.uid())));
create policy "subs update own" on public.submissions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update on public.submissions from authenticated, anon;
grant insert (task_id, code, typed_chars, pasted_chars) on public.submissions to authenticated;
grant update (code, typed_chars, pasted_chars) on public.submissions to authenticated;
-- submitted_at / in_session / ai_* are set by submit_task() and the AI function only

-- notes: one-way, trainer -> trainee
create policy "notes read" on public.notes for select to authenticated
  using (exists (select 1 from public.submissions s join public.tasks t on t.id = s.task_id
                 where s.id = submission_id and (s.user_id = auth.uid() or private.is_trainer_of(t.class_id))));
create policy "notes write" on public.notes for insert to authenticated
  with check (trainer_id = auth.uid() and exists (select 1 from public.submissions s join public.tasks t on t.id = s.task_id
                 where s.id = submission_id and private.is_trainer_of(t.class_id)));

-- error events (for "common errors"): trainee writes own, trainer reads class
create policy "errors insert own" on public.error_events for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and private.is_member_of(t.class_id)));
create policy "errors read" on public.error_events for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.tasks t where t.id = task_id and private.is_trainer_of(t.class_id)));

-- ---------- RPCs ----------
create function public.become_trainer(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_code is null or p_code <> (select value from private.settings where key = 'trainer_code') then
    raise exception 'رمز اعتماد المدربين غير صحيح';
  end if;
  update public.profiles set role = 'trainer' where id = auth.uid();
  return true;
end $$;

create function public.join_class(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into c from public.classes where code = upper(trim(p_code));
  if c is null then raise exception 'رمز الفصل غير صحيح'; end if;
  insert into public.members (class_id, user_id) values (c, auth.uid()) on conflict do nothing;
  return c;
end $$;

create function public.create_class(p_name text) returns public.classes
language plpgsql security definer set search_path = '' as $$
declare r public.classes; k text; alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if not private.is_trainer() then raise exception 'للمدربين فقط'; end if;
  loop
    k := '';
    for i in 1..6 loop k := k || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.classes where code = k);
  end loop;
  insert into public.classes (name, code, trainer_id) values (trim(p_name), k, auth.uid()) returning * into r;
  return r;
end $$;

-- open (or reopen) a task: creates the draft row so time-to-solve can be measured
create function public.open_task(p_task uuid) returns public.submissions
language plpgsql security definer set search_path = '' as $$
declare r public.submissions; t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not private.is_member_of(t.class_id) or (t.target_user is not null and t.target_user <> auth.uid()) then
    raise exception 'غير مسموح';
  end if;
  insert into public.submissions (task_id, user_id, code) values (p_task, auth.uid(), t.starter_code)
    on conflict (task_id, user_id) do nothing;
  select * into r from public.submissions where task_id = p_task and user_id = auth.uid();
  return r;
end $$;

create function public.submit_task(p_task uuid, p_code text, p_typed int, p_pasted int) returns public.submissions
language plpgsql security definer set search_path = '' as $$
declare r public.submissions; t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not private.is_member_of(t.class_id) then raise exception 'غير مسموح'; end if;
  update public.submissions
     set code = left(p_code, 20000), typed_chars = greatest(p_typed,0), pasted_chars = greatest(p_pasted,0),
         submitted_at = now(), in_session = (select live_slide is not null from public.classes where id = t.class_id),
         ai_verdict = null, ai_feedback = null, graded_at = null
   where task_id = p_task and user_id = auth.uid()
   returning * into r;
  return r;
end $$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.become_trainer(text), public.join_class(text), public.create_class(text),
  public.open_task(uuid), public.submit_task(uuid, text, int, int) to authenticated;

-- ---------- class metrics for the trainer dashboard ----------
create function public.class_metrics(p_class uuid) returns table (
  user_id uuid, full_name text, tasks_total int, tasks_done int, typed_pct int, avg_minutes int, in_session_pct int)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.full_name,
    (select count(*) from public.tasks t where t.class_id = p_class and (t.target_user is null or t.target_user = m.user_id))::int,
    count(s.submitted_at)::int,
    case when sum(s.typed_chars + s.pasted_chars) > 0
         then round(100.0 * sum(s.typed_chars) / sum(s.typed_chars + s.pasted_chars))::int end,
    round(avg(extract(epoch from (s.submitted_at - s.opened_at)) / 60) filter (where s.submitted_at is not null))::int,
    case when count(s.submitted_at) > 0
         then round(100.0 * count(*) filter (where s.in_session) / count(s.submitted_at))::int end
  from public.members m
  join public.profiles p on p.id = m.user_id
  left join public.submissions s on s.user_id = m.user_id
       and s.task_id in (select id from public.tasks where class_id = p_class)
  where m.class_id = p_class and private.is_trainer_of(p_class)
  group by m.user_id, p.full_name
  order by p.full_name;
$$;
grant execute on function public.class_metrics(uuid) to authenticated;

-- ---------- storage: private bucket for lecture PDFs ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lectures', 'lectures', false, 15728640, array['application/pdf']);

create policy "lecture files trainer write" on storage.objects for insert to authenticated
  with check (bucket_id = 'lectures' and private.is_trainer_of(((storage.foldername(name))[1])::uuid));
create policy "lecture files trainer delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lectures' and private.is_trainer_of(((storage.foldername(name))[1])::uuid));
create policy "lecture files read" on storage.objects for select to authenticated
  using (bucket_id = 'lectures' and (private.is_trainer_of(((storage.foldername(name))[1])::uuid)
                                     or private.is_member_of(((storage.foldername(name))[1])::uuid)));

-- realtime: trainees follow the trainer's live slide
alter publication supabase_realtime add table public.classes;

-- AI usage log for rate limiting (only the edge function with the service role touches it)
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null,
  created_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;
create index ai_usage_user_time on public.ai_usage (user_id, created_at);
revoke all on public.ai_usage from anon, authenticated;

-- the trainer has the final word on any AI verdict
alter table public.submissions add column trainer_override boolean not null default false;
create function public.set_verdict(p_sub uuid, p_verdict text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_verdict not in ('correct','partial','wrong') then raise exception 'قيمة غير صحيحة'; end if;
  if not exists (select 1 from public.submissions s join public.tasks t on t.id = s.task_id
                 where s.id = p_sub and private.is_trainer_of(t.class_id)) then raise exception 'للمدرب فقط'; end if;
  update public.submissions set ai_verdict = p_verdict, trainer_override = true where id = p_sub;
end $$;
revoke execute on function public.set_verdict(uuid, text) from anon, public;
grant execute on function public.set_verdict(uuid, text) to authenticated;
