-- Разделение по предметам: ученик курса русского не видит банк заданий по литературе, и наоборот.
-- Предмет задания: ege-lit — литература, остальные источники — русский язык.
-- Демо-задания чужого предмета вошедшему ученику тоже не показываются (гостям — как раньше).
-- Задания из занятий, которые открыл преподаватель, видны всегда; ученик без курсов видит всё, как раньше.

create or replace function public.subject_ok(p_source text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_teacher()
      or coalesce((select case when cardinality(p.courses) = 0 then true
                               else exists (select 1 from unnest(p.courses) c
                                            where c like (case when p_source = 'ege-lit' then 'lit' else 'rus' end) || ':%')
                          end
                   from public.profiles p where p.id = auth.uid()), true);
$$;
grant execute on function public.subject_ok(text) to anon, authenticated;

create or replace function public.can_see_task(t public.tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  select (t.is_demo and public.subject_ok(t.source))
      or public.is_teacher()
      or (public.has_access() and (public.in_my_lesson(t.id) or (t.is_published and public.subject_ok(t.source))));
$$;

drop policy if exists tasks_visible on public.tasks;
create policy tasks_visible on public.tasks for select to anon, authenticated
  using ((is_demo and public.subject_ok(source)) or (public.has_access() and (public.in_my_lesson(id) or (is_published and public.subject_ok(source)))));

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
