-- Ученики — под псевдонимами, без почты и телефона. Аккаунты создаёт преподаватель (функция «admin»),
-- вход по логину, пароль сбрасывает преподаватель. Telegram — только у преподавателя.

-- Ученик больше не может сам вписать имя или контакт: псевдоним задаёт преподаватель.
create or replace function public.guard_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_teacher() then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.access_until is distinct from old.access_until
       or new.approved_at is distinct from old.approved_at
       or new.email is distinct from old.email
       or new.courses is distinct from old.courses
       or new.tg_chat_id is distinct from old.tg_chat_id
       or new.tg_code is distinct from old.tg_code
       or new.full_name is distinct from old.full_name
       or new.contact is distinct from old.contact then
      raise exception 'only teacher can change role, status, access, name or courses';
    end if;
  end if;
  return new;
end $$;

-- Привязка Telegram — только для преподавателя.
create or replace function public.tg_link()
returns text language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if auth.uid() is null or not public.is_teacher() then raise exception 'teacher only'; end if;
  select tg_code into c from public.profiles where id = auth.uid();
  if c is null then
    c := substr(md5(random()::text || clock_timestamp()::text || auth.uid()::text), 1, 12);
    update public.profiles set tg_code = c where id = auth.uid();
  end if;
  return c;
end $$;

-- Отвязать Telegram у всех учеников и убрать неотправленные им сообщения.
update public.profiles set tg_chat_id = null, tg_code = null where role <> 'teacher';
delete from public.notify_queue q using public.profiles p where p.id = q.profile_id and p.role <> 'teacher';
