-- Пометки преподавателя: в тексте (фрагмент + тип ошибки + комментарий) и на фото (линии и надписи).
-- {"text": [{"start","end","type","note"}], "photos": {"<путь>": {"strokes": [...], "labels": [...]}}}
alter table public.written_works add column if not exists annotations jsonb;

create or replace function public.guard_written_work()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_teacher() or current_user not in ('anon', 'authenticated') then
    new.updated_at := now();
    if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
    if new.status in ('graded', 'returned') and new.reviewed_at is null then new.reviewed_at := now(); end if;
    return new;
  end if;
  if new.item_id is not null and not public.item_open_for_answers(new.item_id, auth.uid()) then
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
