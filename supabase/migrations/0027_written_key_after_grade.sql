-- Пояснения и образцы к заданиям, которые проверяет преподаватель (сочинения, развёрнутые ответы),
-- ученик видит только после оценки преподавателя — в уроке, в контрольной и в свободной тренировке.
-- Ручное «Открыть разбор» в уроке (lesson_items.revealed) по-прежнему открывает раньше.

create or replace function public.key_unlocked(p_item uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when t.answer_mode in ('open', 'essay') then
      i.revealed or exists (select 1 from public.written_works w
                            where w.item_id = i.id and w.student_id = p_student and w.status = 'graded')
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
  from public.lesson_items i join public.tasks t on t.id = i.task_id
  where i.id = p_item;
$$;
revoke execute on function public.key_unlocked(uuid, uuid) from public, anon, authenticated;

create or replace function public.show_solution(p_task bigint, p_item uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.tasks; k public.task_keys; allowed boolean;
begin
  select * into t from public.tasks where id = p_task;
  if not found or not public.can_see_task(t) then raise exception 'no access'; end if;
  if public.is_teacher() or (auth.uid() is null and t.is_demo and t.answer_mode not in ('open', 'essay')) then
    allowed := true;
  elsif p_item is not null then
    allowed := exists (select 1 from public.lesson_items i where i.id = p_item and i.task_id = p_task
                         and public.can_access_lesson(i.lesson_id))
               and public.key_unlocked(p_item, auth.uid());
  elsif t.answer_mode in ('open', 'essay') then
    -- свободная тренировка, письменное задание: только после оценки преподавателя
    allowed := auth.uid() is not null and not public.in_active_test(p_task) and
               exists (select 1 from public.written_works w where w.task_id = p_task and w.student_id = auth.uid()
                         and w.item_id is null and w.status = 'graded');
  else
    -- свободная практика: нужна своя попытка вне урока, и задание не в идущей контрольной
    allowed := not public.in_active_test(p_task) and
               exists (select 1 from public.attempts a where a.task_id = p_task and a.student_id = auth.uid() and a.item_id is null);
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
