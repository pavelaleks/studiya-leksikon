-- Telegram снова доступен ученикам: подписываются сами в разделе «Я» (кнопка «Подключить Telegram»).
-- Приходят: новые занятия и письменные работы, напоминание накануне срока и после срока, проверенные работы.
-- В сообщениях — только псевдоним ученика и названия работ.
-- Плюс: преподаватель может сохранять в хранилище работ страницу с напечатанным текстом ученика,
-- чтобы проверять его стилусом так же, как фото тетради.

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
      case r.kind when 'exam' then '⏱ Пробный экзамен' when 'test' then '📋 Контрольная' when 'written' then '✍️ Письменная работа' else '📘 Новое занятие' end
        || ': «' || r.title || '»'
        || coalesce(' — сдать до ' || to_char(due at time zone 'Asia/Barnaul', 'DD.MM HH24:MI'), ''),
      'lesson/' || r.id);
  end loop;
end $$;

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
  -- срок прошёл за последние сутки, а работа не сдана — одно напоминание
  for r in
    select distinct l.id, l.title, x.student_id
      from public.lessons l
      join public.lesson_items i on i.lesson_id = l.id
      join lateral (
        select l.student_id where l.student_id is not null
        union select gm.student_id from public.group_members gm where gm.group_id = l.group_id
        union select la.student_id from public.lesson_assignees la where la.lesson_id = l.id
      ) x(student_id) on true
     where l.status = 'live' and not l.self_made and l.kind in ('lesson', 'written')
       and i.due_at between now() - interval '24 hours' and now()
       and exists (select 1 from public.lesson_items i2 where i2.lesson_id = l.id
                    and not exists (select 1 from public.attempts a where a.item_id = i2.id and a.student_id = x.student_id)
                    and not exists (select 1 from public.written_works w where w.item_id = i2.id and w.student_id = x.student_id and w.status <> 'draft'))
  loop
    perform public.notify(r.student_id, 'overdue', r.id::text,
      '⌛ Срок сдачи прошёл: «' || r.title || '». Сдай как можно скорее — работу ещё можно отправить.',
      'lesson/' || r.id);
  end loop;
end $$;

create or replace function public.tg_on_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text; what text; lid uuid; lkind text; ltitle text;
begin
  select l.id, l.kind, l.title into lid, lkind, ltitle
    from public.lesson_items i join public.lessons l on l.id = i.lesson_id where i.id = new.item_id;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
  select case t.source when 'ege-rus' then 'ЕГЭ рус.' when 'oge-rus' then 'ОГЭ рус.' when 'vpr-rus' then 'ВПР рус.' else 'ЕГЭ лит.' end || ' № ' || t.task_no
    into what from public.tasks t where t.id = new.task_id;
  if lkind = 'written' then what := '«' || ltitle || '»'; end if;
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    perform public.notify_teachers('work-in', new.id::text || '-' || extract(epoch from now())::bigint,
      '📝 Новая работа на проверку: ' || coalesce(who, 'ученик') || ' · ' || coalesce(what, ''), 'cabinet/works/' || new.id);
  end if;
  if new.status in ('graded', 'returned') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.notify(new.student_id, 'work-' || new.status, new.id::text || '-' || extract(epoch from now())::bigint,
      case when new.status = 'graded'
        then '✅ Работа проверена: ' || coalesce(what, '') || coalesce(' — ' || trim_scale(new.score) || coalesce(' из ' || trim_scale(new.max_score), '') || ' баллов', '') || '. Посмотри пометки и комментарий.'
        else '✏️ Работу вернули на доработку: ' || coalesce(what, '') || '. Посмотри пометки и исправь.' end,
      case when lid is not null then 'lesson/' || lid else 'me/profile#works' end);
  end if;
  return null;
end $$;

drop policy if exists works_teacher_upload on storage.objects;
create policy works_teacher_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'works' and public.is_teacher());
