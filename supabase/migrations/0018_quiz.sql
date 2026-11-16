-- «Проверь себя перед экзаменом» для гостей главной: 5 случайных заданий с автопроверкой.
-- Сервер запоминает выданные задания (сеанс) и проверяет ответы только на них и только один раз,
-- поэтому через тест нельзя выкачать ответы всего банка.

create table if not exists public.quiz_sessions (
  id         uuid primary key default gen_random_uuid(),
  exam       text not null,
  task_ids   bigint[] not null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
alter table public.quiz_sessions enable row level security;  -- доступ только через функции ниже

-- Какие номера годятся для быстрого теста (без текста-основы, кроме ВПР, и без ручной проверки).
create or replace function public.quiz_numbers(p_exam text)
returns integer[] language sql immutable set search_path = '' as $$
  select case p_exam
    when 'ege-rus' then array[5,6,7,9,10,11,12,13,14,15,16,17,18,19,20,21]
    when 'oge-rus' then array[4,5,6,7,8,9]
    when 'vpr-rus' then array[2,3,4,5,8,9,10]
  end;
$$;

create or replace function public.quiz_start(p_exam text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare nums integer[] := public.quiz_numbers(p_exam); ids bigint[]; sid uuid; pid text;
begin
  if nums is null then raise exception 'unknown exam'; end if;
  delete from public.quiz_sessions where created_at < now() - interval '1 day';
  if p_exam = 'vpr-rus' then
    -- ВПР: все задания — по одному тексту; берём текст, к которому больше всего подходящих заданий (в банке — до 4)
    select t.passage_id into pid from public.tasks t
     where t.source = p_exam and t.is_published and t.task_no = any (nums)
       and t.answer_mode not in ('open', 'essay') and t.passage_id is not null
     group by t.passage_id having count(distinct t.task_no) >= 3
     order by count(distinct t.task_no) desc, random() limit 1;
    if pid is null then raise exception 'no quiz tasks'; end if;
    select array_agg(id) into ids from (
      select id from (
        select distinct on (t.task_no) t.id, t.task_no from public.tasks t
         where t.passage_id = pid and t.source = p_exam and t.is_published and t.task_no = any (nums)
           and t.answer_mode not in ('open', 'essay')
         order by t.task_no, random()
      ) per_no order by random() limit 5
    ) x;
  else
    select array_agg(id) into ids from (
      select id from (
        select distinct on (t.task_no) t.id, t.task_no from public.tasks t
         where t.source = p_exam and t.is_published and t.task_no = any (nums)
           and t.answer_mode not in ('open', 'essay') and t.passage_id is null
         order by t.task_no, random()
      ) per_no order by random() limit 5
    ) x;
  end if;
  if coalesce(array_length(ids, 1), 0) < 3 then raise exception 'no quiz tasks'; end if;
  insert into public.quiz_sessions (exam, task_ids) values (p_exam, ids) returning id into sid;
  return jsonb_build_object(
    'session', sid,
    'passage', (select jsonb_build_object('id', p.id, 'html', p.html) from public.passages p where p.id = pid),
    'tasks', (select jsonb_agg(jsonb_build_object('id', t.id, 'task_no', t.task_no, 'mode', t.answer_mode,
                                                  'question', t.data->>'questionHtml') order by t.task_no)
                from public.tasks t where t.id = any (ids)));
end $$;

-- Проверка: только задания своего сеанса и только один раз. Возвращает верно/неверно и правильный ответ.
create or replace function public.quiz_check(p_session uuid, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s public.quiz_sessions; res jsonb := '[]'::jsonb; t public.tasks; k public.task_keys; a text;
begin
  select * into s from public.quiz_sessions where id = p_session for update;
  if not found then raise exception 'quiz expired'; end if;
  if s.checked_at is not null then raise exception 'quiz already checked'; end if;
  update public.quiz_sessions set checked_at = now() where id = p_session;
  for t in select * from public.tasks where id = any (s.task_ids) order by task_no loop
    select * into k from public.task_keys where task_id = t.id;
    a := coalesce(p_answers ->> t.id::text, '');
    res := res || jsonb_build_object('id', t.id, 'task_no', t.task_no,
                                     'correct', a <> '' and public.check_answer(k, t.answer_mode, a),
                                     'answer', replace(coalesce(k.answer, ''), '|', ' или '));
  end loop;
  return jsonb_build_object('exam', s.exam, 'results', res);
end $$;

revoke execute on function public.quiz_start(text), public.quiz_check(uuid, jsonb) from public;
grant execute on function public.quiz_start(text), public.quiz_check(uuid, jsonb) to anon, authenticated;
revoke execute on function public.quiz_numbers(text) from public, anon, authenticated;
