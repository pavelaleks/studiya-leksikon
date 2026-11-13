-- Контрольные и пробные экзамены: назначение группе и/или ученикам, ограничение по времени,
-- таймер считается на сервере (старт, конец, сдача), результаты — после завершения или по команде.

alter table public.lessons
  add column if not exists kind text not null default 'lesson' check (kind in ('lesson', 'test', 'exam')),
  add column if not exists exam_code text,                       -- 'ege-rus' | 'oge-rus' | 'ege-lit'
  add column if not exists duration_minutes integer check (duration_minutes between 5 and 600),
  add column if not exists closes_at timestamptz,                -- начать можно до этого момента
  add column if not exists show_results text not null default 'manual' check (show_results in ('manual', 'after_finish'));

alter table public.lessons drop constraint if exists lessons_check;
alter table public.lessons add constraint lessons_target_check check (num_nonnulls(group_id, student_id) <= 1);

-- Отдельные ученики (вместе с группой или без неё).
create table if not exists public.lesson_assignees (
  lesson_id  uuid references public.lessons on delete cascade,
  student_id uuid references public.profiles on delete cascade,
  primary key (lesson_id, student_id)
);
create index if not exists lesson_assignees_student_idx on public.lesson_assignees (student_id);

-- Попытка прохождения работы на время.
create table if not exists public.exam_sessions (
  lesson_id   uuid references public.lessons on delete cascade,
  student_id  uuid references public.profiles on delete cascade,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  primary key (lesson_id, student_id)
);

alter table public.lesson_assignees enable row level security;
alter table public.exam_sessions    enable row level security;
create policy teacher_all on public.lesson_assignees for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy teacher_all on public.exam_sessions for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy own_assignment on public.lesson_assignees for select to authenticated using (student_id = auth.uid());
create policy own_session on public.exam_sessions for select to authenticated using (student_id = auth.uid());

create or replace function public.can_access_lesson(p_lesson uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_access() and exists (
    select 1 from public.lessons l
    where l.id = p_lesson and l.status <> 'draft' and (
         l.student_id = auth.uid()
      or exists (select 1 from public.group_members gm
                 where gm.group_id = l.group_id and gm.student_id = auth.uid())
      or exists (select 1 from public.lesson_assignees a
                 where a.lesson_id = l.id and a.student_id = auth.uid())));
$$;

-- Конец отведённого времени для ученика (null — работа не на время или ещё не начата).
create or replace function public.session_ends_at(p_lesson uuid, p_student uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select s.started_at + make_interval(mins => l.duration_minutes)
  from public.exam_sessions s join public.lessons l on l.id = s.lesson_id
  where s.lesson_id = p_lesson and s.student_id = p_student and l.duration_minutes is not null;
$$;

-- Работа ученика завершена: нажал «Завершить» или время вышло (+2 мин на отправку).
create or replace function public.session_over(p_lesson uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.finished_at is not null
        or (l.duration_minutes is not null
            and now() > s.started_at + make_interval(mins => l.duration_minutes) + interval '2 minutes')
    from public.exam_sessions s join public.lessons l on l.id = s.lesson_id
    where s.lesson_id = p_lesson and s.student_id = p_student), false);
$$;

-- Можно ли сейчас отвечать на задание урока: для работ на время — только внутри своей сессии.
create or replace function public.item_open_for_answers(p_item uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when l.duration_minutes is null then true
              else exists (select 1 from public.exam_sessions s
                           where s.lesson_id = l.id and s.student_id = p_student)
                   and not public.session_over(l.id, p_student) end
  from public.lesson_items i join public.lessons l on l.id = i.lesson_id
  where i.id = p_item;
$$;

-- Виден ли ученику результат задания контрольной / экзамена.
create or replace function public.item_result_visible(p_item uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select i.revealed
      or (i.due_at is not null and now() >= i.due_at)
      or (l.show_results = 'after_finish' and public.session_over(l.id, p_student))
  from public.lesson_items i join public.lessons l on l.id = i.lesson_id
  where i.id = p_item;
$$;

create or replace function public.key_unlocked(p_item uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when i.kind = 'test' then public.item_result_visible(i.id, p_student)
    else i.revealed or case i.reveal
      when 'after_attempt' then exists (select 1 from public.attempts a where a.item_id = i.id and a.student_id = p_student)
      when 'after_correct' then exists (select 1 from public.attempts a where a.item_id = i.id and a.student_id = p_student and a.is_correct)
                             or (i.attempts_limit is not null and
                                 (select count(*) from public.attempts a where a.item_id = i.id and a.student_id = p_student) >= i.attempts_limit)
      when 'after_due'     then i.due_at is not null and now() >= i.due_at
      when 'after_review'  then exists (select 1 from public.written_works w
                                         where w.item_id = i.id and w.student_id = p_student and w.status = 'graded')
      when 'manual'        then false
    end
  end
  from public.lesson_items i where i.id = p_item;
$$;

create or replace function public.in_active_test(p_task bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lesson_items i
                 where i.task_id = p_task and i.kind = 'test'
                   and public.can_access_lesson(i.lesson_id)
                   and not public.item_result_visible(i.id, auth.uid()));
$$;

create or replace function public.submit_answer(
  p_task bigint, p_answer text, p_item uuid default null, p_seconds int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks; k public.task_keys; itm public.lesson_items;
  ok boolean; used int := 0; lesson_mode boolean := p_item is not null; hide boolean := false;
begin
  if length(coalesce(p_answer, '')) > 500 then raise exception 'answer too long'; end if;
  select * into t from public.tasks where id = p_task;
  if not found or not public.can_see_task(t) then raise exception 'no access'; end if;
  if t.answer_mode in ('open', 'essay') then raise exception 'this task is checked by teacher'; end if;
  select * into k from public.task_keys where task_id = p_task;
  if not lesson_mode and auth.uid() is not null and public.in_active_test(p_task) then
    raise exception 'task is in an active test';
  end if;
  if lesson_mode then
    select * into itm from public.lesson_items where id = p_item and task_id = p_task and not hidden;
    if not found or not public.can_access_lesson(itm.lesson_id) then raise exception 'no access'; end if;
    if not public.item_open_for_answers(p_item, auth.uid()) then raise exception 'time is over'; end if;
    select count(*) into used from public.attempts where item_id = p_item and student_id = auth.uid();
    if itm.attempts_limit is not null and used >= itm.attempts_limit then raise exception 'attempts exhausted'; end if;
    if itm.kind = 'test' and itm.due_at is not null and now() > itm.due_at then raise exception 'deadline passed'; end if;
    hide := itm.kind = 'test' and not public.item_result_visible(p_item, auth.uid());
  end if;
  ok := public.check_answer(k, t.answer_mode, p_answer);
  if auth.uid() is not null then
    insert into public.attempts (student_id, task_id, item_id, answer, is_correct, seconds)
    values (auth.uid(), p_task, p_item, p_answer, ok, p_seconds);
  end if;
  return jsonb_build_object(
    'correct', case when hide then null else ok end,
    'hidden', hide,
    'attempts_left', case when lesson_mode and itm.attempts_limit is not null
                          then itm.attempts_limit - used - 1 end,
    'can_reveal', case when hide then false
                       when lesson_mode then public.key_unlocked(p_item, auth.uid()) else true end,
    'answer',   case when ok and not hide then k.answer end,
    'solution', case when ok and not hide then k.solution_html end);
end $$;

-- Письменные ответы в работе на время: сдавать и править можно только пока идёт время.
create or replace function public.guard_written_work()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_teacher() or current_user not in ('anon', 'authenticated') then
    new.updated_at := now();
    if new.status in ('graded', 'returned') and new.reviewed_at is null then new.reviewed_at := now(); end if;
    return new;
  end if;
  if new.item_id is not null and not public.item_open_for_answers(new.item_id, auth.uid()) then
    raise exception 'time is over';
  end if;
  if tg_op = 'INSERT' then
    if not public.has_access() then raise exception 'no access'; end if;
    new.criteria := null; new.score := null; new.max_score := null;
    new.teacher_comment := null; new.reviewed_at := null;
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
  new.student_id := old.student_id; new.task_id := old.task_id; new.item_id := old.item_id;
  if new.status = 'submitted' then new.submitted_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;

-- Ученик начинает работу на время. Возвращает серверное «сейчас» и конец времени.
create or replace function public.start_exam(p_lesson uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.lessons; s public.exam_sessions;
begin
  if not public.can_access_lesson(p_lesson) then raise exception 'no access'; end if;
  select * into l from public.lessons where id = p_lesson;
  if l.duration_minutes is null then raise exception 'not a timed work'; end if;
  select * into s from public.exam_sessions where lesson_id = p_lesson and student_id = auth.uid();
  if not found then
    if l.starts_at is not null and now() < l.starts_at then raise exception 'not started yet'; end if;
    if l.closes_at is not null and now() > l.closes_at then raise exception 'start window closed'; end if;
    insert into public.exam_sessions (lesson_id, student_id) values (p_lesson, auth.uid()) returning * into s;
  end if;
  return jsonb_build_object('now', now(), 'started_at', s.started_at, 'finished_at', s.finished_at,
    'ends_at', s.started_at + make_interval(mins => l.duration_minutes),
    'over', public.session_over(p_lesson, auth.uid()));
end $$;

create or replace function public.finish_exam(p_lesson uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.exam_sessions set finished_at = coalesce(finished_at, now())
   where lesson_id = p_lesson and student_id = auth.uid();
  if not found then raise exception 'not started'; end if;
  return jsonb_build_object('finished', true);
end $$;

-- Состояние работы на время без старта (для экрана «Начать»).
create or replace function public.exam_state(p_lesson uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l public.lessons; s public.exam_sessions;
begin
  if not public.can_access_lesson(p_lesson) then raise exception 'no access'; end if;
  select * into l from public.lessons where id = p_lesson;
  select * into s from public.exam_sessions where lesson_id = p_lesson and student_id = auth.uid();
  return jsonb_build_object('now', now(), 'started_at', s.started_at, 'finished_at', s.finished_at,
    'ends_at', case when s.started_at is not null and l.duration_minutes is not null
                    then s.started_at + make_interval(mins => l.duration_minutes) end,
    'over', public.session_over(p_lesson, auth.uid()));
end $$;

revoke execute on function public.session_ends_at(uuid, uuid) from public, anon;
revoke execute on function public.session_over(uuid, uuid) from public, anon;
revoke execute on function public.item_open_for_answers(uuid, uuid) from public, anon;
revoke execute on function public.item_result_visible(uuid, uuid) from public, anon;
grant execute on function public.session_ends_at(uuid, uuid), public.session_over(uuid, uuid),
  public.item_open_for_answers(uuid, uuid), public.item_result_visible(uuid, uuid) to authenticated;
revoke execute on function public.start_exam(uuid), public.finish_exam(uuid), public.exam_state(uuid) from public, anon;
grant execute on function public.start_exam(uuid), public.finish_exam(uuid), public.exam_state(uuid) to authenticated;
grant execute on function public.submit_answer(bigint, text, uuid, int) to anon, authenticated;

alter publication supabase_realtime add table public.exam_sessions;
