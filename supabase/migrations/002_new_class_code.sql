-- Trainer can replace the class join code (if it leaked outside the class).
create function public.new_class_code(p_class uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare k text; alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if not private.is_trainer_of(p_class) then raise exception 'للمدرب فقط'; end if;
  loop
    k := '';
    for i in 1..6 loop k := k || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.classes where code = k);
  end loop;
  update public.classes set code = k where id = p_class;
  return k;
end $$;
revoke execute on function public.new_class_code(uuid) from public, anon;
grant execute on function public.new_class_code(uuid) to authenticated;
