-- ВПР по русскому языку, 8 класс: новый источник заданий «vpr-rus» (банк «Решу ВПР», задания 1–12).
-- Ученики 5–8 классов по русскому получают трек ВПР; пробник ВПР — 90 минут (без письменной части — 45).

alter table public.tasks drop constraint if exists tasks_source_check;
alter table public.tasks add constraint tasks_source_check check (source in ('ege-rus', 'oge-rus', 'vpr-rus', 'ege-lit'));

create or replace function public.create_self_exam(p_code text, p_tasks bigint[], p_written boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare lid uuid; mins integer; title text; n integer;
begin
  if auth.uid() is null or not public.has_access() then raise exception 'no access'; end if;
  mins := case
    when p_written then case p_code when 'ege-rus' then 210 when 'oge-rus' then 175 when 'vpr-rus' then 90 when 'ege-lit' then 235 end
    else case p_code when 'ege-rus' then 90 when 'oge-rus' then 90 when 'vpr-rus' then 45 when 'ege-lit' then 60 end
  end;
  if mins is null then raise exception 'unknown exam'; end if;
  n := coalesce(array_length(p_tasks, 1), 0);
  if n < 5 or n > 30 then raise exception 'bad variant'; end if;
  if (select count(*) from public.tasks t where t.id = any (p_tasks) and t.source = p_code and t.is_published) <> n then
    raise exception 'bad variant';
  end if;
  if not p_written and exists (select 1 from public.tasks t where t.id = any (p_tasks) and t.answer_mode in ('open', 'essay')) then
    raise exception 'bad variant';
  end if;
  if (select count(*) from public.lessons l where l.student_id = auth.uid() and l.self_made
        and l.created_at > now() - interval '1 day') >= 3 then
    raise exception 'too many self exams';
  end if;
  title := 'Мой пробный ' || case p_code when 'ege-rus' then 'ЕГЭ по русскому' when 'oge-rus' then 'ОГЭ по русскому'
                                        when 'vpr-rus' then 'ВПР по русскому' else 'ЕГЭ по литературе' end
           || case when p_written then '' else ' (без письменной части)' end
           || ' · ' || to_char(now() at time zone 'Asia/Barnaul', 'DD.MM');
  insert into public.lessons (title, kind, exam_code, duration_minutes, show_results, status, student_id, self_made, starts_at)
  values (title, 'exam', p_code, mins, 'after_finish', 'live', auth.uid(), true, now())
  returning id into lid;
  insert into public.lesson_items (lesson_id, task_id, position, kind, reveal, attempts_limit)
  select lid, t, ord, 'test', 'after_due', null from unnest(p_tasks) with ordinality as u(t, ord);
  return lid;
end $$;
revoke execute on function public.create_self_exam(text, bigint[], boolean) from public, anon;
grant execute on function public.create_self_exam(text, bigint[], boolean) to authenticated;

-- Подпись задания в уведомлениях Telegram
create or replace function public.tg_on_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text; what text;
begin
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
  select case t.source when 'ege-rus' then 'ЕГЭ рус.' when 'oge-rus' then 'ОГЭ рус.' when 'vpr-rus' then 'ВПР рус.' else 'ЕГЭ лит.' end || ' № ' || t.task_no
    into what from public.tasks t where t.id = new.task_id;
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    perform public.notify_teachers('work-in', new.id::text || '-' || extract(epoch from now())::bigint,
      '📝 Новая работа на проверку: ' || coalesce(who, 'ученик') || ' · ' || coalesce(what, ''), 'cabinet/works/' || new.id);
  end if;
  if new.status in ('graded', 'returned') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.notify(new.student_id, 'work-' || new.status, new.id::text || '-' || extract(epoch from now())::bigint,
      case when new.status = 'graded'
        then '✅ Работа проверена: ' || coalesce(what, '') || coalesce(' — ' || trim_scale(new.score) || coalesce(' из ' || trim_scale(new.max_score), '') || ' баллов', '') || '. Посмотри пометки и комментарий.'
        else '✏️ Работу вернули на доработку: ' || coalesce(what, '') || '. Посмотри пометки и исправь.' end,
      'me/profile#works');
  end if;
  return null;
end $$;
