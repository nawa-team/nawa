-- نوء — innovation features:
-- 1) «تمرين الشريحة»: an exercise is pinned to a slide. When the trainer reaches that slide in a live
--    session, the exercise pops up for every trainee at the same moment.
-- 2) «نبض الشريحة»: a trainee taps «لم أفهم» on a slide without her name showing. The trainer sees
--    only the count per slide (never who), and AI suggests a simpler explanation.
-- Also: the trainer can hide (lock) a lecture from trainees.

alter table public.tasks add column slide int check (slide is null or slide between 1 and 999);
alter table public.classes add column live_lecture uuid references public.lectures(id) on delete set null;
alter table public.lectures add column hidden boolean not null default false;

-- hidden lectures are visible to the trainer only
drop policy "lectures read" on public.lectures;
create policy "lectures read" on public.lectures for select to authenticated
  using (private.is_trainer_of(class_id) or (private.is_member_of(class_id) and not hidden));

-- ---------- slide pulse ----------
create table public.slide_pulse (
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  slide int not null check (slide between 1 and 999),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (lecture_id, slide, user_id)
);
alter table public.slide_pulse enable row level security;

-- a trainee sees and changes only her own taps. The trainer has NO row access: only counts, via the RPC below.
create policy "pulse read own" on public.slide_pulse for select to authenticated using (user_id = auth.uid());
create policy "pulse add own" on public.slide_pulse for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.lectures l where l.id = lecture_id and private.is_member_of(l.class_id) and not l.hidden));
create policy "pulse remove own" on public.slide_pulse for delete to authenticated using (user_id = auth.uid());

create function public.pulse_counts(p_lecture uuid) returns table (slide int, n int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.lectures l where l.id = p_lecture and private.is_trainer_of(l.class_id)) then
    raise exception 'للمدرب فقط';
  end if;
  return query select p.slide, count(*)::int from public.slide_pulse p where p.lecture_id = p_lecture group by p.slide order by p.slide;
end $$;
revoke execute on function public.pulse_counts(uuid) from public, anon;
grant execute on function public.pulse_counts(uuid) to authenticated;

-- ---------- demo protection for the new trainer tools ----------
-- the demo lecture's file, title and visibility can't be changed by visitors
create or replace function private.guard_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  demo text := (select value from private.settings where key = 'demo_class');
  cid text := case when tg_table_name = 'classes' then (to_jsonb(old) ->> 'id') else (to_jsonb(old) ->> 'class_id') end;
begin
  if auth.uid() is not null and demo <> '' and cid = demo then
    if tg_op = 'DELETE' then
      raise exception 'هذا فصل تجريبي محمي. جرّب ذلك في فصل جديد تنشئه';
    end if;
    if to_jsonb(new) ->> 'code' is distinct from to_jsonb(old) ->> 'code'
       or to_jsonb(new) ->> 'name' is distinct from to_jsonb(old) ->> 'name'
       or to_jsonb(new) ->> 'title' is distinct from to_jsonb(old) ->> 'title'
       or to_jsonb(new) ->> 'file_path' is distinct from to_jsonb(old) ->> 'file_path'
       or to_jsonb(new) ->> 'hidden' is distinct from to_jsonb(old) ->> 'hidden' then
      raise exception 'هذا فصل تجريبي محمي. جرّب ذلك في فصل جديد تنشئه';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger guard_demo_lectures_update before update on public.lectures
  for each row execute function private.guard_demo();

create function private.is_demo_folder(f text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.settings where key = 'demo_class' and value <> '' and value = f);
$$;
grant execute on function private.is_demo_folder(text) to authenticated;

-- lecture files: the trainer of the class, or the person who uploaded the file (so files can be
-- cleaned up after a class is deleted), can delete. Demo files can't be deleted by visitors.
drop policy "lecture files trainer delete" on storage.objects;
create policy "lecture files trainer delete" on storage.objects for delete to authenticated
  using (bucket_id = 'lectures' and not private.is_demo_folder((storage.foldername(name))[1])
         and (private.is_trainer_of(((storage.foldername(name))[1])::uuid) or owner_id = auth.uid()::text));
