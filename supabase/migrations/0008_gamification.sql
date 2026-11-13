-- Очки за самостоятельную работу и самостоятельный пробный экзамен.
-- Очки начисляет только сервер (триггеры): ученик не может их «накрутить».

create table if not exists public.xp_events (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.profiles on delete cascade,
  kind       text not null,          -- solve | work | graded | exam | test | reading
  points     integer not null,
  ref        text not null,          -- что именно (id задания, работы, урока)
  created_at timestamptz not null default now(),
  unique (student_id, kind, ref)
);
create index if not exists xp_events_student_idx on public.xp_events (student_id, created_at desc);

alter table public.xp_events enable row level security;
create policy teacher_all on public.xp_events for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy own_xp on public.xp_events for select to authenticated using (student_id = auth.uid());

alter table public.lessons add column if not exists self_made boolean not null default false;

-- Верно решённое задание (первый раз): 10 очков сразу, 5 — после ошибок, 2 — после разбора.
-- Задания контрольных и экзаменов не дают очков сразу (иначе очки выдали бы правильность ответа).
create or replace function public.award_attempt_xp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pts integer;
begin
  if not new.is_correct then return null; end if;
  if new.item_id is not null and exists (select 1 from public.lesson_items i where i.id = new.item_id and i.kind = 'test') then
    return null;
  end if;
  if exists (select 1 from public.attempts a where a.student_id = new.student_id and a.task_id = new.task_id
             and a.is_correct and a.id <> new.id) then
    return null;
  end if;
  pts := case
    when exists (select 1 from public.solution_views v where v.student_id = new.student_id and v.task_id = new.task_id) then 2
    when exists (select 1 from public.attempts a where a.student_id = new.student_id and a.task_id = new.task_id and not a.is_correct) then 5
    else 10 end;
  insert into public.xp_events (student_id, kind, points, ref) values (new.student_id, 'solve', pts, new.task_id::text)
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists attempts_award_xp on public.attempts;
create trigger attempts_award_xp after insert on public.attempts
  for each row execute function public.award_attempt_xp();

-- Письменная работа: 15 очков за сдачу, до 10 — по итогу проверки.
create or replace function public.award_work_xp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    insert into public.xp_events (student_id, kind, points, ref) values (new.student_id, 'work', 15, new.id::text)
    on conflict do nothing;
  end if;
  if new.status = 'graded' and (tg_op = 'INSERT' or old.status is distinct from 'graded') then
    insert into public.xp_events (student_id, kind, points, ref)
    values (new.student_id, 'graded',
            case when coalesce(new.max_score, 0) > 0 then greatest(1, round(10 * coalesce(new.score, 0) / new.max_score))::int else 5 end,
            new.id::text)
    on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists written_works_award_xp on public.written_works;
create trigger written_works_award_xp after insert or update on public.written_works
  for each row execute function public.award_work_xp();

-- Завершил работу на время: экзамен — 30 очков, контрольная — 15.
create or replace function public.award_exam_xp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if new.finished_at is not null and old.finished_at is null then
    select kind into k from public.lessons where id = new.lesson_id;
    insert into public.xp_events (student_id, kind, points, ref)
    values (new.student_id, case when k = 'exam' then 'exam' else 'test' end, case when k = 'exam' then 30 else 15 end, new.lesson_id::text)
    on conflict do nothing;
    -- +3 за каждый верный ответ (по последнему ответу на каждое задание)
    insert into public.xp_events (student_id, kind, points, ref)
    select new.student_id, 'exam_correct', 3 * count(*)::int, new.lesson_id::text
      from (select distinct on (a.item_id) a.is_correct
              from public.attempts a join public.lesson_items i on i.id = a.item_id
             where i.lesson_id = new.lesson_id and a.student_id = new.student_id
             order by a.item_id, a.created_at desc) last
     where last.is_correct
    having count(*) > 0
    on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists exam_sessions_award_xp on public.exam_sessions;
create trigger exam_sessions_award_xp after update on public.exam_sessions
  for each row execute function public.award_exam_xp();

-- Дни, когда ученик занимался (по времени Горно-Алтайска), — для серии дней и цели дня.
create or replace view public.my_days with (security_invoker = true) as
select d, count(*)::int as actions, sum(correct)::int as correct from (
  select (a.created_at at time zone 'Asia/Barnaul')::date as d, a.is_correct::int as correct
    from public.attempts a where a.student_id = auth.uid()
  union all
  select (w.submitted_at at time zone 'Asia/Barnaul')::date, 0
    from public.written_works w where w.student_id = auth.uid() and w.submitted_at is not null
) x group by d;

-- Ученик сам запускает пробный экзамен (вариант собирает сайт, сервер проверяет состав).
create or replace function public.create_self_exam(p_code text, p_tasks bigint[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare lid uuid; mins integer; title text; n integer;
begin
  if auth.uid() is null or not public.has_access() then raise exception 'no access'; end if;
  mins := case p_code when 'ege-rus' then 210 when 'oge-rus' then 175 when 'ege-lit' then 235 end;
  if mins is null then raise exception 'unknown exam'; end if;
  n := coalesce(array_length(p_tasks, 1), 0);
  if n < 5 or n > 30 then raise exception 'bad variant'; end if;
  if (select count(*) from public.tasks t where t.id = any (p_tasks) and t.source = p_code and t.is_published) <> n then
    raise exception 'bad variant';
  end if;
  if (select count(*) from public.lessons l where l.student_id = auth.uid() and l.self_made
        and l.created_at > now() - interval '1 day') >= 3 then
    raise exception 'too many self exams';
  end if;
  title := 'Мой пробный ' || case p_code when 'ege-rus' then 'ЕГЭ по русскому' when 'oge-rus' then 'ОГЭ по русскому' else 'ЕГЭ по литературе' end
           || ' · ' || to_char(now() at time zone 'Asia/Barnaul', 'DD.MM');
  insert into public.lessons (title, kind, exam_code, duration_minutes, show_results, status, student_id, self_made, starts_at)
  values (title, 'exam', p_code, mins, 'after_finish', 'live', auth.uid(), true, now())
  returning id into lid;
  insert into public.lesson_items (lesson_id, task_id, position, kind, reveal, attempts_limit)
  select lid, t, ord, 'test', 'after_due', null from unnest(p_tasks) with ordinality as u(t, ord);
  return lid;
end $$;

revoke execute on function public.award_attempt_xp(), public.award_work_xp(), public.award_exam_xp() from public, anon, authenticated;
revoke execute on function public.create_self_exam(text, bigint[]) from public, anon;
grant execute on function public.create_self_exam(text, bigint[]) to authenticated;
