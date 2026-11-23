-- نوء — a live session ends by itself if the trainer forgets to end it.
-- live_at is refreshed every time the trainer starts the session or moves a slide;
-- the app treats the class as live only if live_at is less than 3 hours old.
alter table public.classes add column live_at timestamptz;

create function private.touch_live() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.live_slide is not null then new.live_at := now(); else new.live_at := null; end if;
  return new;
end $$;

create trigger touch_live before insert or update of live_slide on public.classes
  for each row execute function private.touch_live();
