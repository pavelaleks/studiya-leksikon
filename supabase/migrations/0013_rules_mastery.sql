-- «Проверь себя» к правилам: глава правил закрепляется, если ученик верно решил 4 из 5 заданий
-- соответствующего номера ЕГЭ. Ответы проверяет сервер (обычный submit_answer), итог — здесь.

create table if not exists public.rule_chapters (
  chapter_id text primary key,
  source     text not null default 'ege-rus',
  task_nos   integer[] not null
);
alter table public.rule_chapters enable row level security;
create policy read_all on public.rule_chapters for select to anon, authenticated using (true);
create policy teacher_all on public.rule_chapters for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
grant select on public.rule_chapters to anon, authenticated;
grant insert, update, delete on public.rule_chapters to authenticated;

insert into public.rule_chapters (chapter_id, task_nos) values
  ('orfo-r1', '{9}'), ('ortho-iv', '{10}'), ('ortho-v', '{10}'), ('ortho-vi', '{11}'),
  ('ortho-vii', '{11}'), ('ortho-viii', '{11,15}'), ('ortho-ix', '{14}'), ('ortho-xi', '{14}'),
  ('ortho-xii', '{12}'), ('ortho-xiii', '{12,15}'), ('ortho-xiv', '{14}'), ('ortho-xv', '{14}'),
  ('ortho-xvi', '{14}'), ('ortho-xvii', '{13,14}'),
  ('punct-xxi', '{21}'), ('punct-xxii', '{16}'), ('punct-xxiv', '{17}'), ('punct-xxv', '{17}'),
  ('punct-xxvi', '{18}'), ('punct-xxviii', '{16}'), ('punct-xxix', '{19}'), ('punct-xxx', '{19}'),
  ('punct-xxxii', '{21}'), ('punct-xxxvi', '{20}'),
  ('stil-xxxv', '{5,6}'), ('stil-xxxvi', '{7}'), ('stil-xxxvii', '{7}'), ('stil-xxxviii', '{7}'),
  ('stil-xxxix', '{7}'), ('stil-xl', '{7}'), ('stil-xliii', '{8}'), ('stil-xliv', '{8}'),
  ('stil-xlv', '{8}'), ('stil-xlvi', '{8}'), ('stil-xlvii', '{8}'), ('stil-xlviii', '{8}')
on conflict (chapter_id) do update set task_nos = excluded.task_nos;

create table if not exists public.rules_mastered (
  student_id  uuid not null references public.profiles on delete cascade,
  chapter_id  text not null,
  score       integer not null,
  total       integer not null,
  mastered_at timestamptz not null default now(),
  primary key (student_id, chapter_id)
);
alter table public.rules_mastered enable row level security;
create policy teacher_all on public.rules_mastered for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy own_rules on public.rules_mastered for select to authenticated using (student_id = auth.uid());
grant select, delete on public.rules_mastered to authenticated;

-- Итог проверки: по каждому заданию берётся первый ответ ученика за последние 2 часа.
create or replace function public.rule_quiz_finish(p_chapter text, p_tasks bigint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m record; n integer; ok integer := 0; answered integer := 0; passed boolean; got integer := 0; t bigint; first_ok boolean;
begin
  if auth.uid() is null or not public.has_access() then raise exception 'no access'; end if;
  select * into m from public.rule_chapters where chapter_id = p_chapter;
  if not found then raise exception 'unknown chapter'; end if;
  n := coalesce(array_length(p_tasks, 1), 0);
  if n < 3 or n > 10 then raise exception 'bad quiz'; end if;
  if (select count(*) from public.tasks x where x.id = any (p_tasks) and x.source = m.source and x.task_no = any (m.task_nos)) <> n then
    raise exception 'bad quiz';
  end if;
  foreach t in array p_tasks loop
    select a.is_correct into first_ok from public.attempts a
     where a.student_id = auth.uid() and a.task_id = t and a.created_at > now() - interval '2 hours'
     order by a.created_at limit 1;
    if found then
      answered := answered + 1;
      if first_ok then ok := ok + 1; end if;
    end if;
  end loop;
  if answered < n then raise exception 'not finished'; end if;
  passed := ok >= ceil(n * 0.8);
  if passed then
    insert into public.rules_mastered (student_id, chapter_id, score, total) values (auth.uid(), p_chapter, ok, n)
    on conflict (student_id, chapter_id) do update set score = excluded.score, total = excluded.total, mastered_at = now();
    insert into public.xp_events (student_id, kind, points, ref) values (auth.uid(), 'rule', 15, p_chapter)
    on conflict do nothing;
    get diagnostics got = row_count;
  end if;
  return jsonb_build_object('correct', ok, 'total', n, 'passed', passed, 'points', case when got > 0 then 15 else 0 end);
end $$;

revoke execute on function public.rule_quiz_finish(text, bigint[]) from public, anon;
grant execute on function public.rule_quiz_finish(text, bigint[]) to authenticated;
