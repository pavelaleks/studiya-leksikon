-- Проверенная работа: ученик должен увидеть пометки, а преподаватель — убрать работу в архив.
-- seen_at     — ученик открыл проверенную (или возвращённую) работу и нажал «Посмотрел(а)».
-- archived_at — преподаватель убрал работу из списка «Проверенные» в архив.
-- Новая проверка (новый reviewed_at) снова делает работу непросмотренной и достаёт её из архива.
alter table public.written_works add column if not exists seen_at timestamptz;
alter table public.written_works add column if not exists archived_at timestamptz;
create index if not exists written_works_unseen_idx on public.written_works (student_id)
  where status in ('graded', 'returned') and seen_at is null;

-- Старые проверки (больше двух недель назад) считаем просмотренными, чтобы у учеников
-- не появился длинный список давно закрытых работ. Свежие останутся непросмотренными.
update public.written_works set seen_at = reviewed_at
 where status in ('graded', 'returned') and seen_at is null and reviewed_at < now() - interval '14 days';

create or replace function public.guard_written_work()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_teacher() or current_user not in ('anon', 'authenticated') then
    new.updated_at := now();
    if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
    if new.status in ('graded', 'returned') and new.reviewed_at is null then new.reviewed_at := now(); end if;
    -- преподаватель отправил новую проверку: ученик ещё не видел её, из архива — обратно
    if tg_op = 'UPDATE' and new.reviewed_at is distinct from old.reviewed_at then
      new.seen_at := null; new.archived_at := null;
    end if;
    return new;
  end if;
  if new.item_id is not null and not public.item_open_for_answers(new.item_id, auth.uid()) then
    raise exception 'time is over';
  end if;
  if tg_op = 'INSERT' then
    if not public.has_access() then raise exception 'no access'; end if;
    new.criteria := null; new.score := null; new.max_score := null;
    new.teacher_comment := null; new.reviewed_at := null; new.annotations := null;
    new.seen_at := null; new.archived_at := null;
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
  new.seen_at := old.seen_at; new.archived_at := old.archived_at;
  new.student_id := old.student_id; new.task_id := old.task_id; new.item_id := old.item_id;
  if new.status = 'submitted' then new.submitted_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;

-- Ученик закрывает проверенную работу: «Посмотрел(а) пометки».
-- Сама работа после проверки заблокирована для ученика, поэтому отметка — через функцию.
create or replace function public.mark_work_seen(p_work uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare t timestamptz;
begin
  if auth.uid() is null then raise exception 'no access'; end if;
  update public.written_works set seen_at = coalesce(seen_at, now())
   where id = p_work and student_id = auth.uid() and status in ('graded', 'returned')
  returning seen_at into t;
  return t;
end $$;
revoke execute on function public.mark_work_seen(uuid) from public, anon;
grant execute on function public.mark_work_seen(uuid) to authenticated;

-- Telegram «Работа проверена»: ссылка ведёт прямо на работу в занятии, а не на список занятия.

create or replace function public.tg_on_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text; what text; lid uuid; lkind text; ltitle text;
begin
  select l.id, l.kind, l.title into lid, lkind, ltitle
    from public.lesson_items i join public.lessons l on l.id = i.lesson_id where i.id = new.item_id;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
  select case when t.source = 'itog' then 'итоговое сочинение'
              else case t.source when 'ege-rus' then 'ЕГЭ рус.' when 'oge-rus' then 'ОГЭ рус.' when 'vpr-rus' then 'ВПР рус.'
                                 when 'oge-lit' then 'ОГЭ лит.' else 'ЕГЭ лит.' end || ' № ' || t.task_no end
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
      case when lid is not null then 'lesson/' || lid || '/' || new.item_id else 'me/profile#works' end);
  end if;
  return null;
end $$;
