-- Проверенная работа: ученик должен её открыть, а потом сам убирает в архив.
--   seen_at     — когда ученик впервые открыл проверку (пометки, баллы, комментарий);
--   archived_at — когда ученик нажал «Посмотрел — в архив» (работа уходит с главной).
-- Преподаватель при новой оценке/возврате сбрасывает оба поля — уведомление появляется снова.

alter table public.written_works
  add column if not exists seen_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Работы, проверенные до этой миграции, ученики уже видели (или нет — но поднимать их все разом не нужно):
-- уведомление оставляем только за последние 14 дней.
update public.written_works
   set seen_at = coalesce(reviewed_at, updated_at), archived_at = coalesce(reviewed_at, updated_at)
 where status in ('graded', 'returned') and seen_at is null
   and coalesce(reviewed_at, updated_at) < now() - interval '14 days';

create or replace function public.work_seen(p_id uuid, p_archive boolean default false)
returns void language sql security definer set search_path = '' as $$
  update public.written_works
     set seen_at = coalesce(seen_at, now()),
         archived_at = case when p_archive then now() else archived_at end
   where id = p_id and student_id = auth.uid() and status in ('graded', 'returned');
$$;
revoke execute on function public.work_seen(uuid, boolean) from public, anon;
grant execute on function public.work_seen(uuid, boolean) to authenticated;

-- Ссылка в Telegram ведёт прямо на страницу проверки.
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
      'me/work/' || new.id);
  end if;
  return null;
end $$;
