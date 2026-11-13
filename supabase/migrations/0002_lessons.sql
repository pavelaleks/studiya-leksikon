-- Занятия: задания урока видны ученикам урока даже если не опубликованы в общем банке;
-- контрольная скрывает результат до срока; индекс для поиска уроков по заданию.
create index if not exists lesson_items_task_idx on public.lesson_items (task_id);

create or replace function public.in_my_lesson(p_task bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lesson_items i
                 where i.task_id = p_task and not i.hidden and public.can_access_lesson(i.lesson_id));
$$;

create or replace function public.can_see_task(t public.tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  select t.is_demo
      or public.is_teacher()
      or (public.has_access() and (t.is_published or public.in_my_lesson(t.id)));
$$;

-- Задание сейчас в незакрытой контрольной этого ученика — вне урока его проверять и смотреть разбор нельзя.
create or replace function public.in_active_test(p_task bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lesson_items i
                 where i.task_id = p_task and i.kind = 'test' and not i.revealed
                   and (i.due_at is null or now() < i.due_at)
                   and public.can_access_lesson(i.lesson_id));
$$;

drop policy if exists tasks_visible on public.tasks;
create policy tasks_visible on public.tasks for select to anon, authenticated
  using (is_demo or (public.has_access() and (is_published or public.in_my_lesson(id))));

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
    select count(*) into used from public.attempts where item_id = p_item and student_id = auth.uid();
    if itm.attempts_limit is not null and used >= itm.attempts_limit then raise exception 'attempts exhausted'; end if;
    if itm.kind = 'test' and itm.due_at is not null and now() > itm.due_at then raise exception 'deadline passed'; end if;
    -- контрольная: результат и разбор — после срока или когда преподаватель откроет
    hide := itm.kind = 'test' and not itm.revealed and (itm.due_at is null or now() < itm.due_at);
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

grant execute on function public.submit_answer(bigint, text, uuid, int) to anon, authenticated;
revoke execute on function public.in_my_lesson(bigint) from public;
grant execute on function public.in_my_lesson(bigint) to anon, authenticated;

create or replace function public.show_solution(p_task bigint, p_item uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.tasks; k public.task_keys; allowed boolean;
begin
  select * into t from public.tasks where id = p_task;
  if not found or not public.can_see_task(t) then raise exception 'no access'; end if;
  if public.is_teacher() or (auth.uid() is null and t.is_demo) then
    allowed := true;
  elsif p_item is not null then
    allowed := exists (select 1 from public.lesson_items i where i.id = p_item and i.task_id = p_task
                         and public.can_access_lesson(i.lesson_id))
               and public.key_unlocked(p_item, auth.uid());
  else
    -- свободная практика: нужна своя попытка вне урока (или сданная работа), и задание не в идущей контрольной
    allowed := not public.in_active_test(p_task) and (
               exists (select 1 from public.attempts a where a.task_id = p_task and a.student_id = auth.uid() and a.item_id is null)
            or exists (select 1 from public.written_works w where w.task_id = p_task and w.student_id = auth.uid()
                         and w.item_id is null and w.status <> 'draft'));
  end if;
  if not allowed then return jsonb_build_object('locked', true); end if;
  select * into k from public.task_keys where task_id = p_task;
  if auth.uid() is not null and not public.is_teacher()
     and not exists (select 1 from public.attempts a where a.task_id = p_task and a.student_id = auth.uid() and a.is_correct) then
    insert into public.solution_views (student_id, task_id) values (auth.uid(), p_task) on conflict do nothing;
  end if;
  return jsonb_build_object('locked', false, 'answer', k.answer, 'solution', k.solution_html);
end $$;

grant execute on function public.show_solution(bigint, uuid) to anon, authenticated;
revoke execute on function public.in_active_test(bigint) from public, anon;
grant execute on function public.in_active_test(bigint) to authenticated;
