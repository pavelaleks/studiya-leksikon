-- Уведомления в Telegram: привязка аккаунта, очередь сообщений, события и вечернее напоминание.
-- Отправляет функция Supabase «tg» (supabase/functions/tg), ключ бота — в её секретах.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table public.profiles add column if not exists tg_chat_id bigint;
alter table public.profiles add column if not exists tg_code text unique;

-- Ученик не может сам вписать себе чужой chat_id: его ставит только функция бота.
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
       or new.tg_code is distinct from old.tg_code then
      raise exception 'only teacher can change role, status, access or courses';
    end if;
  end if;
  return new;
end $$;

create or replace view public.me with (security_invoker = true) as
select id, role, status, full_name, email, grade, exam_target, study_format, contact, access_until, created_at, courses,
       (tg_chat_id is not null) as tg_linked
from public.profiles where id = auth.uid();

create table if not exists public.app_settings (
  key   text primary key,
  value text
);
alter table public.app_settings enable row level security;
create policy read_all on public.app_settings for select to anon, authenticated using (true);
grant select on public.app_settings to anon, authenticated;

create table if not exists public.notify_queue (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles on delete cascade,
  kind       text not null,
  ref        text not null,
  text       text not null,
  url        text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text,
  unique (profile_id, kind, ref)
);
alter table public.notify_queue enable row level security;
create policy teacher_read on public.notify_queue for select to authenticated using (public.is_teacher());
grant select on public.notify_queue to authenticated;

-- Код привязки для ссылки t.me/<бот>?start=<код>
create or replace function public.tg_link()
returns text language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'no access'; end if;
  select tg_code into c from public.profiles where id = auth.uid();
  if c is null then
    c := substr(md5(random()::text || clock_timestamp()::text || auth.uid()::text), 1, 12);
    update public.profiles set tg_code = c where id = auth.uid();
  end if;
  return c;
end $$;

create or replace function public.tg_unlink()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set tg_chat_id = null where id = auth.uid();
$$;

revoke execute on function public.tg_link(), public.tg_unlink() from public, anon;
grant execute on function public.tg_link(), public.tg_unlink() to authenticated;

-- Поставить сообщение в очередь (только тем, кто подключил Telegram).
create or replace function public.notify(p_profile uuid, p_kind text, p_ref text, p_text text, p_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_profile is null then return; end if;
  if not exists (select 1 from public.profiles where id = p_profile and tg_chat_id is not null) then return; end if;
  insert into public.notify_queue (profile_id, kind, ref, text, url) values (p_profile, p_kind, p_ref, p_text, p_url)
  on conflict (profile_id, kind, ref) do nothing;
end $$;
revoke execute on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.notify_teachers(p_kind text, p_ref text, p_text text, p_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  for t in select id from public.profiles where role = 'teacher' loop
    perform public.notify(t, p_kind, p_ref, p_text, p_url);
  end loop;
end $$;
revoke execute on function public.notify_teachers(text, text, text, text) from public, anon, authenticated;

-- Новые сообщения сразу уходят: просим функцию разослать очередь.
create or replace function public.notify_kick()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://mhlpcwquvphrnpxsjzne.supabase.co/functions/v1/tg',
    body := '{"action":"dispatch"}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return null;
end $$;
drop trigger if exists notify_queue_kick on public.notify_queue;
create trigger notify_queue_kick after insert on public.notify_queue
  for each statement execute function public.notify_kick();

-- Функция бота забирает пачку неотправленных (параллельные вызовы не возьмут одно и то же дважды).
create or replace function public.tg_claim()
returns table (id bigint, profile_id uuid, chat_id bigint, text text, url text)
language sql security definer set search_path = '' as $$
  update public.notify_queue q set sent_at = now()
    from public.profiles p
   where p.id = q.profile_id and p.tg_chat_id is not null
     and q.id in (select n.id from public.notify_queue n
                   where n.sent_at is null and n.created_at > now() - interval '2 days'
                   order by n.id limit 50 for update skip locked)
  returning q.id, q.profile_id, p.tg_chat_id, q.text, q.url;
$$;
revoke execute on function public.tg_claim() from public, anon, authenticated;
grant execute on function public.tg_claim() to service_role;

/* ---------- события ---------- */

-- Письменные работы: ученику — «проверена / вернули», преподавателю — «сдана».
create or replace function public.tg_on_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text; what text;
begin
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
  select case t.source when 'ege-rus' then 'ЕГЭ рус.' when 'oge-rus' then 'ОГЭ рус.' else 'ЕГЭ лит.' end || ' № ' || t.task_no
    into what from public.tasks t where t.id = new.task_id;
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    perform public.notify_teachers('work-in', new.id::text || '-' || extract(epoch from now())::bigint,
      '📝 Новая работа на проверку: ' || coalesce(who, 'ученик') || ' · ' || coalesce(what, ''), 'cabinet/works/' || new.id);
  end if;
  if new.status in ('graded', 'returned') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.notify(new.student_id, 'work-' || new.status, new.id::text || '-' || extract(epoch from now())::bigint,
      case when new.status = 'graded'
        then '✅ Работа проверена: ' || coalesce(what, '') || coalesce(' — ' || trim_scale(new.score) || coalesce(' из ' || trim_scale(new.max_score), '') || ' баллов', '') || '. Посмотри пометки и комментарий.'
        else '✏️ Работу вернули на доработку: ' || coalesce(what, '') || '. Посмотри пометки и исправь.' end,
      'me/profile#works');
  end if;
  return null;
end $$;
drop trigger if exists written_works_tg on public.written_works;
create trigger written_works_tg after insert or update of status on public.written_works
  for each row execute function public.tg_on_work();

-- Заявки и запросы на курсы — преподавателю.
create or replace function public.tg_on_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'student' and new.status = 'pending' then
    perform public.notify_teachers('signup', new.id::text,
      '🙋 Новая заявка: ' || coalesce(nullif(new.full_name, ''), new.email, 'ученик') || coalesce(' · ' || new.exam_target, ''), 'cabinet/students');
  end if;
  return null;
end $$;
drop trigger if exists profiles_tg on public.profiles;
create trigger profiles_tg after insert on public.profiles for each row execute function public.tg_on_profile();

create or replace function public.tg_on_course_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  if new.status <> 'pending' then return null; end if;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
  perform public.notify_teachers('course', new.id::text || '-' || extract(epoch from new.created_at)::bigint,
    '📚 ' || coalesce(who, 'Ученик') || ' просит курс: ' || case split_part(new.course, ':', 1) when 'lit' then 'литература' else 'русский язык' end
      || ', ' || split_part(new.course, ':', 2) || ' класс', 'cabinet/students');
  return null;
end $$;
drop trigger if exists course_requests_tg on public.course_requests;
create trigger course_requests_tg after insert or update of status on public.course_requests
  for each row execute function public.tg_on_course_request();

-- Занятие открыто ученикам. Занятие создаётся в несколько запросов (строка, потом задания и ученики),
-- поэтому рассылку делает проверка раз в 5 минут: занятие открыто больше 2 минут назад и уже наступило.
alter table public.lessons add column if not exists live_at timestamptz;
update public.lessons set live_at = coalesce(starts_at, created_at) where status <> 'draft' and live_at is null;

create or replace function public.lesson_live_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then new.live_at := now(); end if;
  return new;
end $$;
drop trigger if exists lessons_live_at on public.lessons;
create trigger lessons_live_at before insert or update of status on public.lessons
  for each row execute function public.lesson_live_at();
drop trigger if exists lessons_tg on public.lessons;
drop function if exists public.tg_on_lesson();

create or replace function public.tg_scan_lessons()
returns void language plpgsql security definer set search_path = '' as $$
declare r record; due timestamptz;
begin
  for r in
    select l.id, l.title, l.kind, x.student_id
      from public.lessons l
      join lateral (
        select l.student_id where l.student_id is not null
        union select gm.student_id from public.group_members gm where gm.group_id = l.group_id
        union select la.student_id from public.lesson_assignees la where la.lesson_id = l.id
      ) x(student_id) on true
      join public.profiles p on p.id = x.student_id and p.tg_chat_id is not null and p.status = 'active'
     where l.status = 'live' and not l.self_made
       and l.live_at between now() - interval '2 days' and now() - interval '2 minutes'
       and coalesce(l.starts_at, l.live_at) <= now()
       and exists (select 1 from public.lesson_items i where i.lesson_id = l.id)
       and not exists (select 1 from public.notify_queue q where q.profile_id = x.student_id and q.kind = 'lesson' and q.ref = l.id::text)
  loop
    select min(due_at) into due from public.lesson_items where lesson_id = r.id;
    perform public.notify(r.student_id, 'lesson', r.id::text,
      case r.kind when 'exam' then '⏱ Пробный экзамен' when 'test' then '📋 Контрольная' else '📘 Новое занятие' end
        || ': «' || r.title || '»'
        || coalesce(' — сдать до ' || to_char(due at time zone 'Asia/Barnaul', 'DD.MM HH24:MI'), ''),
      'lesson/' || r.id);
  end loop;
end $$;
revoke execute on function public.tg_scan_lessons() from public, anon, authenticated;

-- Вечером (19:00 по Горно-Алтайску): серия дней и сроки завтра.
create or replace function public.tg_evening()
returns void language plpgsql security definer set search_path = '' as $$
declare r record; today date := (now() at time zone 'Asia/Barnaul')::date;
begin
  delete from public.notify_queue where created_at < now() - interval '60 days';
  -- занимался в последние 3 дня, но не сегодня — напомнить про серию
  for r in
    select p.id from public.profiles p
     where p.role = 'student' and p.status = 'active' and p.tg_chat_id is not null
       and exists (select 1 from public.attempts a where a.student_id = p.id
                    and (a.created_at at time zone 'Asia/Barnaul')::date between today - 3 and today - 1)
       and not exists (select 1 from public.attempts a where a.student_id = p.id
                        and (a.created_at at time zone 'Asia/Barnaul')::date = today)
  loop
    perform public.notify(r.id, 'streak', today::text,
      '🔥 Сегодня ещё не занимался — реши хотя бы несколько заданий, чтобы не прервать серию. Тренировка дня ждёт.', 'me/daily');
  end loop;
  -- срок сдачи в ближайшие сутки, а работа не сделана
  for r in
    select distinct l.id, l.title, x.student_id, min(i.due_at) over (partition by l.id) as due
      from public.lessons l
      join public.lesson_items i on i.lesson_id = l.id
      join lateral (
        select l.student_id where l.student_id is not null
        union select gm.student_id from public.group_members gm where gm.group_id = l.group_id
        union select la.student_id from public.lesson_assignees la where la.lesson_id = l.id
      ) x(student_id) on true
     where l.status = 'live' and not l.self_made and i.due_at between now() and now() + interval '28 hours'
       and exists (select 1 from public.lesson_items i2 where i2.lesson_id = l.id
                    and not exists (select 1 from public.attempts a where a.item_id = i2.id and a.student_id = x.student_id)
                    and not exists (select 1 from public.written_works w where w.item_id = i2.id and w.student_id = x.student_id and w.status <> 'draft'))
  loop
    perform public.notify(r.student_id, 'due', r.id::text || '-' || today::text,
      '⏰ Скоро срок: «' || r.title || '» — до ' || to_char(r.due at time zone 'Asia/Barnaul', 'DD.MM HH24:MI') || '. Есть несделанные задания.',
      'lesson/' || r.id);
  end loop;
end $$;
revoke execute on function public.tg_evening() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('tg-evening', 'tg-lessons');
select cron.schedule('tg-evening', '0 12 * * *', 'select public.tg_evening()');
select cron.schedule('tg-lessons', '*/5 * * * *', 'select public.tg_scan_lessons()');
