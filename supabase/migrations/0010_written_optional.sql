-- Письменные работы — отдельный трек по желанию со своей наградой.
-- 1) Самостоятельный пробный экзамен можно собрать без письменной части (её проверяет преподаватель).
-- 2) За проверенную работу — до 40 очков по итогу (было до 10); за сдачу по-прежнему 15.

drop function if exists public.create_self_exam(text, bigint[]);

create or replace function public.create_self_exam(p_code text, p_tasks bigint[], p_written boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare lid uuid; mins integer; title text; n integer;
begin
  if auth.uid() is null or not public.has_access() then raise exception 'no access'; end if;
  mins := case
    when p_written then case p_code when 'ege-rus' then 210 when 'oge-rus' then 175 when 'ege-lit' then 235 end
    else case p_code when 'ege-rus' then 90 when 'oge-rus' then 90 when 'ege-lit' then 60 end
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
  title := 'Мой пробный ' || case p_code when 'ege-rus' then 'ЕГЭ по русскому' when 'oge-rus' then 'ОГЭ по русскому' else 'ЕГЭ по литературе' end
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
            case when coalesce(new.max_score, 0) > 0 then greatest(2, round(40 * coalesce(new.score, 0) / new.max_score))::int else 20 end,
            new.id::text)
    on conflict do nothing;
  end if;
  return null;
end $$;
revoke execute on function public.award_work_xp() from public, anon, authenticated;
