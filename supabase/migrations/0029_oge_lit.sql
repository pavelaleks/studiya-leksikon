-- ОГЭ по литературе: новый источник заданий «oge-lit» (банк «Решу ОГЭ», задания 1–5, все письменные).
-- Предмет — литература (как ege-lit); трек курса lit:9 ведёт на ОГЭ, теория к заданиям — по треку.

alter table public.tasks drop constraint if exists tasks_source_check;
alter table public.tasks add constraint tasks_source_check
  check (source in ('ege-rus', 'oge-rus', 'vpr-rus', 'ege-lit', 'oge-lit'));

alter table public.task_theory drop constraint if exists task_theory_source_check;
alter table public.task_theory add constraint task_theory_source_check
  check (source in ('ege-rus', 'oge-rus', 'vpr-rus', 'ege-lit', 'oge-lit'));

create or replace function public.subject_ok(p_source text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_teacher()
      or coalesce((select case when cardinality(p.courses) = 0 then true
                               else exists (select 1 from unnest(p.courses) c
                                            where c like (case when p_source in ('ege-lit', 'oge-lit') then 'lit' else 'rus' end) || ':%')
                          end
                   from public.profiles p where p.id = auth.uid()), true);
$$;
grant execute on function public.subject_ok(text) to anon, authenticated;

create or replace function public.track_ok(p_source text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_teacher()
      or coalesce((select case when cardinality(p.courses) = 0 then true
                               else exists (select 1 from unnest(p.courses) c where
                                 case p_source when 'ege-lit' then c like 'lit:%'
                                               when 'oge-lit' then c = 'lit:9'
                                               when 'ege-rus' then c in ('rus:10', 'rus:11')
                                               when 'oge-rus' then c = 'rus:9'
                                               when 'vpr-rus' then c in ('rus:5', 'rus:6', 'rus:7', 'rus:8')
                                               else false end)
                          end
                   from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.track_ok(text) to authenticated;

-- Подпись задания в уведомлениях Telegram (тело — как в 0021, добавлена ОГЭ-литература)
create or replace function public.tg_on_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who text; what text; lid uuid; lkind text; ltitle text;
begin
  select l.id, l.kind, l.title into lid, lkind, ltitle
    from public.lesson_items i join public.lessons l on l.id = i.lesson_id where i.id = new.item_id;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
  select case t.source when 'ege-rus' then 'ЕГЭ рус.' when 'oge-rus' then 'ОГЭ рус.' when 'vpr-rus' then 'ВПР рус.'
                       when 'oge-lit' then 'ОГЭ лит.' else 'ЕГЭ лит.' end || ' № ' || t.task_no
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
      case when lid is not null then 'lesson/' || lid else 'me/profile#works' end);
  end if;
  return null;
end $$;

-- Пробный ОГЭ по литературе (3 ч 55 мин; без письменной части варианта нет — все задания письменные)
create or replace function public.create_self_exam(p_code text, p_tasks bigint[], p_written boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare lid uuid; mins integer; title text; n integer;
begin
  if auth.uid() is null or not public.has_access() then raise exception 'no access'; end if;
  mins := case
    when p_written then case p_code when 'ege-rus' then 210 when 'oge-rus' then 175 when 'vpr-rus' then 90 when 'ege-lit' then 235 when 'oge-lit' then 235 end
    else case p_code when 'ege-rus' then 90 when 'oge-rus' then 90 when 'vpr-rus' then 45 when 'ege-lit' then 60 end
  end;
  if mins is null then raise exception 'unknown exam'; end if;
  if not public.subject_ok(p_code) then raise exception 'no access'; end if;
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
                                        when 'vpr-rus' then 'ВПР по русскому' when 'oge-lit' then 'ОГЭ по литературе' else 'ЕГЭ по литературе' end
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
