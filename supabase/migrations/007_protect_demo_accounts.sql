-- Quick-try accounts are shared by every visitor and judge.
-- Nobody may change their email, password or display name, so one visitor cannot lock out or rename them for everyone.
create or replace function private.is_demo_email(e text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(e, '') like '%.demo@nawa.dev';
$$;

create or replace function private.guard_demo_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.is_demo_email(old.email) and (
       new.email is distinct from old.email
    or new.encrypted_password is distinct from old.encrypted_password
    or coalesce(new.email_change, '') not in ('', coalesce(old.email_change, ''))
  ) then
    raise exception 'هذا حساب تجريبي مشترك، ولا يمكن تغيير بريده أو كلمة مروره';
  end if;
  return new;
end $$;

drop trigger if exists guard_demo_user on auth.users;
create trigger guard_demo_user before update on auth.users
  for each row execute function private.guard_demo_user();

create or replace function private.guard_demo_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.full_name is distinct from old.full_name
     and exists (select 1 from auth.users u where u.id = old.id and private.is_demo_email(u.email)) then
    raise exception 'هذا حساب تجريبي مشترك، ولا يمكن تغيير اسمه';
  end if;
  return new;
end $$;

drop trigger if exists guard_demo_profile on public.profiles;
create trigger guard_demo_profile before update on public.profiles
  for each row execute function private.guard_demo_profile();
