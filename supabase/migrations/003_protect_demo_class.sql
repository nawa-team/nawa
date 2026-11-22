-- نوء — protect the public demo class.
-- Anyone can enter the demo through "quick try", so visitors must not be able to delete the demo class,
-- its lectures, tasks or members, or change its code. Everything else (adding tasks, reviewing, notes) still works.
-- Changes made from the SQL editor or the server (no signed-in user) are not blocked, so the team can still reset the demo.

insert into private.settings values ('demo_class', '') on conflict (key) do nothing;
-- set it once: update private.settings set value = '<demo class id>' where key = 'demo_class';

create function private.guard_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  demo text := (select value from private.settings where key = 'demo_class');
  cid text := case when tg_table_name = 'classes' then (to_jsonb(old) ->> 'id') else (to_jsonb(old) ->> 'class_id') end;
begin
  if auth.uid() is not null and demo <> '' and cid = demo then
    if tg_op = 'DELETE' then
      raise exception 'هذا فصل تجريبي محمي. جرّب ذلك في فصل جديد تنشئه';
    end if;
    -- only the classes trigger fires on UPDATE
    if to_jsonb(new) ->> 'code' is distinct from to_jsonb(old) ->> 'code'
       or to_jsonb(new) ->> 'name' is distinct from to_jsonb(old) ->> 'name' then
      raise exception 'هذا فصل تجريبي محمي. جرّب ذلك في فصل جديد تنشئه';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger guard_demo_classes before update or delete on public.classes
  for each row execute function private.guard_demo();
create trigger guard_demo_members before delete on public.members
  for each row execute function private.guard_demo();
create trigger guard_demo_lectures before delete on public.lectures
  for each row execute function private.guard_demo();
create trigger guard_demo_tasks before delete on public.tasks
  for each row execute function private.guard_demo();
