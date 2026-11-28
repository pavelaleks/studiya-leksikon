-- Автозакрытие занятий: открытое занятие закрывается само через 3 дня
--   • после самого позднего срока сдачи, если сроки есть;
--   • после открытия ученикам (live_at / starts_at), если сроков нет.
-- «Закрыто» = status 'done': ученик видит занятие и свои результаты, но новые ответы не принимаются
-- (кроме работ, которые преподаватель вернул на доработку). Ничего не удаляется.
-- Преподаватель может продлить (+3 дня), открыть снова (тоже +3 дня) или выключить автозакрытие у занятия.

alter table public.lessons
  add column if not exists auto_close     boolean not null default true,
  add column if not exists keep_open_until timestamptz,          -- «Продлить»: не закрывать раньше этого момента
  add column if not exists closed_at      timestamptz,
  add column if not exists closed_auto    boolean not null default false,
  add column if not exists close_ack      boolean not null default false;  -- преподаватель увидел сводку

-- Когда занятие закроется само (null — не закроется: черновик, уже закрыто, выключено, сам собрал ученик).
-- Доступно в PostgREST как вычисляемое поле: select=...,auto_close_at
create or replace function public.auto_close_at(l public.lessons)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select case when l.status <> 'live' or not l.auto_close or l.self_made then null
    else greatest(
      coalesce((select max(i.due_at) from public.lesson_items i where i.lesson_id = l.id),
               greatest(coalesce(l.live_at, l.created_at), coalesce(l.starts_at, l.created_at)))
        + interval '3 days',
      l.keep_open_until) end;
$$;
grant execute on function public.auto_close_at(public.lessons) to authenticated;

-- Ученики занятия и сколько из них сделали все задания.
create or replace function public.lesson_roster(p_lesson uuid)
returns table (student_id uuid, finished boolean, started boolean)
language sql stable security definer set search_path = '' as $$
  with l as (select * from public.lessons where id = p_lesson),
  r as (
    select l.student_id from l where l.student_id is not null
    union select gm.student_id from l join public.group_members gm on gm.group_id = l.group_id
    union select la.student_id from public.lesson_assignees la where la.lesson_id = p_lesson
  ),
  d as (
    select r.student_id, i.id as item_id,
           exists (select 1 from public.attempts a where a.item_id = i.id and a.student_id = r.student_id)
        or exists (select 1 from public.written_works w where w.item_id = i.id and w.student_id = r.student_id and w.status <> 'draft') as ok
      from r cross join public.lesson_items i where i.lesson_id = p_lesson and not i.hidden
  )
  select r.student_id, coalesce(bool_and(d.ok), false), coalesce(bool_or(d.ok), false)
    from r left join d on d.student_id = r.student_id group by r.student_id;
$$;
revoke execute on function public.lesson_roster(uuid) from public, anon, authenticated;

-- Отметки статуса: закрытие → closed_at; повторное открытие → ещё 3 дня, сводка сбрасывается.
create or replace function public.lesson_close_marks()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    new.closed_at := now();
    if current_user in ('anon', 'authenticated') then new.closed_auto := false; end if;  -- закрыл преподаватель
  elsif new.status = 'live' and old.status = 'done' then
    new.closed_at := null; new.closed_auto := false; new.close_ack := false;
    new.keep_open_until := greatest(new.keep_open_until, now() + interval '3 days');
  end if;
  return new;
end $$;
drop trigger if exists lessons_close_marks on public.lessons;
create trigger lessons_close_marks before update of status on public.lessons
  for each row execute function public.lesson_close_marks();

-- Закрытое занятие не принимает ответы.
create or replace function public.item_open_for_answers(p_item uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select l.status <> 'done' and case when l.duration_minutes is null then true
              else exists (select 1 from public.exam_sessions s
                           where s.lesson_id = l.id and s.student_id = p_student)
                   and not public.session_over(l.id, p_student) end
  from public.lesson_items i join public.lessons l on l.id = i.lesson_id
  where i.id = p_item;
$$;

-- Работу, возвращённую на доработку, можно исправить и сдать и после закрытия занятия.
create or replace function public.guard_written_work()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_teacher() or current_user not in ('anon', 'authenticated') then
    new.updated_at := now();
    if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
    if new.status in ('graded', 'returned') and new.reviewed_at is null then new.reviewed_at := now(); end if;
    return new;
  end if;
  if new.item_id is not null and not (tg_op = 'UPDATE' and old.status = 'returned')
     and not public.item_open_for_answers(new.item_id, auth.uid()) then
    raise exception 'time is over';
  end if;
  if tg_op = 'INSERT' then
    if not public.has_access() then raise exception 'no access'; end if;
    new.criteria := null; new.score := null; new.max_score := null;
    new.teacher_comment := null; new.reviewed_at := null; new.annotations := null;
    if new.status not in ('draft', 'submitted') then new.status := 'draft'; end if;
    if new.status = 'submitted' then new.submitted_at := now(); end if;
    return new;
  end if;
  if old.status not in ('draft', 'returned') then
    raise exception 'work is locked for review';
  end if;
  if new.status not in ('draft', 'submitted') then
    raise exception 'student can only save or submit';
  end if;
  new.criteria := old.criteria; new.score := old.score; new.max_score := old.max_score;
  new.teacher_comment := old.teacher_comment; new.reviewed_at := old.reviewed_at;
  new.annotations := old.annotations;
  new.student_id := old.student_id; new.task_id := old.task_id; new.item_id := old.item_id;
  if new.status = 'submitted' then new.submitted_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;

-- Контрольную в закрытом занятии начать нельзя.
create or replace function public.start_exam(p_lesson uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.lessons; s public.exam_sessions;
begin
  if not public.can_access_lesson(p_lesson) then raise exception 'no access'; end if;
  select * into l from public.lessons where id = p_lesson;
  if l.duration_minutes is null then raise exception 'not a timed work'; end if;
  select * into s from public.exam_sessions where lesson_id = p_lesson and student_id = auth.uid();
  if not found then
    if l.status = 'done' then raise exception 'start window closed'; end if;
    if l.starts_at is not null and now() < l.starts_at then raise exception 'not started yet'; end if;
    if l.closes_at is not null and now() > l.closes_at then raise exception 'start window closed'; end if;
    insert into public.exam_sessions (lesson_id, student_id) values (p_lesson, auth.uid()) returning * into s;
  end if;
  return jsonb_build_object('now', now(), 'started_at', s.started_at, 'finished_at', s.finished_at,
    'ends_at', s.started_at + make_interval(mins => l.duration_minutes),
    'over', public.session_over(p_lesson, auth.uid()));
end $$;

-- Раз в час: напомнить недоделавшим за сутки до закрытия и закрыть то, чему пора.
create or replace function public.lessons_autoclose()
returns void language plpgsql security definer set search_path = '' as $$
declare l public.lessons; c timestamptz; r record; n int; m int; late text;
begin
  for l in select * from public.lessons where status = 'live' and auto_close and not self_made loop
    c := public.auto_close_at(l);
    continue when c is null;
    if c > now() then
      -- напоминание: до закрытия меньше суток (одно на каждый момент закрытия)
      if c <= now() + interval '24 hours' then
        for r in select x.student_id from public.lesson_roster(l.id) x where not x.finished loop
          perform public.notify(r.student_id, 'close-soon', l.id::text || '-' || extract(epoch from c)::bigint,
            '⏳ Занятие «' || l.title || '» закроется ' || to_char(c at time zone 'Asia/Barnaul', 'DD.MM в HH24:MI')
              || '. Доделай задания — потом ответы уже не примутся.',
            'lesson/' || l.id);
        end loop;
      end if;
      continue;
    end if;
    -- не закрывать, пока кто-то пишет контрольную по таймеру
    continue when exists (select 1 from public.exam_sessions s
                           where s.lesson_id = l.id and s.finished_at is null and not public.session_over(l.id, s.student_id));
    update public.lessons set status = 'done', closed_auto = true, close_ack = false where id = l.id;
    select count(*), count(*) filter (where finished) into m, n from public.lesson_roster(l.id);
    select string_agg(coalesce(nullif(p.full_name, ''), p.email), ', ' order by p.full_name) into late
      from public.lesson_roster(l.id) x join public.profiles p on p.id = x.student_id where not x.finished;
    perform public.notify_teachers('lesson-closed', l.id::text || '-' || extract(epoch from now())::bigint,
      '🔒 Закрыто занятие «' || l.title || '»: сделали ' || n || ' из ' || m
        || coalesce('. Не доделали: ' || late, '') || '.',
      'cabinet/lesson/' || l.id);
  end loop;
end $$;
revoke execute on function public.lessons_autoclose() from public, anon, authenticated;

-- Сводка «Закрылись сами» для преподавателя (вкладка «Сегодня»).
create or replace function public.closed_lessons_digest()
returns table (id uuid, title text, closed_at timestamptz, total int, finished int, missing text[])
language sql stable security definer set search_path = '' as $$
  select l.id, l.title, l.closed_at,
         (select count(*)::int from public.lesson_roster(l.id)),
         (select count(*)::int from public.lesson_roster(l.id) x where x.finished),
         (select array_agg(coalesce(nullif(p.full_name, ''), p.email) order by p.full_name)
            from public.lesson_roster(l.id) x join public.profiles p on p.id = x.student_id where not x.finished)
    from public.lessons l
   where public.is_teacher() and l.status = 'done' and l.closed_auto and not l.close_ack
   order by l.closed_at desc limit 30;
$$;
revoke execute on function public.closed_lessons_digest() from public, anon;
grant execute on function public.closed_lessons_digest() to authenticated;

-- Старые занятия, которым уже пора, закрываем сразу и тихо — без сотни сообщений в Telegram и без сводки.
update public.lessons l set status = 'done', closed_auto = true, close_ack = true
 where l.status = 'live' and l.auto_close and not l.self_made and public.auto_close_at(l) <= now();

select cron.unschedule(jobname) from cron.job where jobname = 'lessons-autoclose';
select cron.schedule('lessons-autoclose', '7 * * * *', 'select public.lessons_autoclose()');

notify pgrst, 'reload schema';
