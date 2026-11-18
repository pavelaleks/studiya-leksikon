-- Напоминания ученикам о занятиях из Google Календаря: каждые 30 минут база просит функцию бота
-- проверить расписание. Функция сама решает, кому и что напомнить (вечером накануне и за ~2 часа),
-- и не дублирует уже поставленные напоминания.
-- Вечерняя рассылка «Скоро срок» сдвинута на 19:40 и пропускает работы, которые уже названы
-- в напоминании о завтрашнем занятии (его функция ставит в 19:00–19:30).
select cron.unschedule(jobname) from cron.job where jobname = 'tg-calendar';
select cron.schedule('tg-calendar', '*/30 * * * *', $job$
  select net.http_post(
    url := 'https://mhlpcwquvphrnpxsjzne.supabase.co/functions/v1/tg',
    body := '{"action":"remind"}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb
  )
$job$);

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
       -- уже есть в напоминании о завтрашнем занятии из календаря — второй раз не пишем
       and not exists (select 1 from public.notify_queue q where q.profile_id = x.student_id and q.kind = 'cal-eve'
                        and q.created_at > now() - interval '3 hours' and position('«' || l.title || '»' in q.text) > 0)
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

select cron.unschedule(jobname) from cron.job where jobname = 'tg-evening';
select cron.schedule('tg-evening', '40 12 * * *', 'select public.tg_evening()');
