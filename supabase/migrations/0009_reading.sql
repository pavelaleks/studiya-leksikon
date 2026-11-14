-- Чтение: тесты по статьям «Полки» и по прочитанным текстам; стихи наизусть.
-- Ответы к тестам и тексты для проверки стихов лежат в закрытых таблицах; проверяет сервер.

create table if not exists public.reading_quizzes (
  id           bigint generated always as identity primary key,
  slug         text unique,                -- для повторной загрузки готовых тестов
  work_id      text,                       -- id произведения из каталога библиотеки
  title        text not null,
  kind         text not null default 'polka' check (kind in ('polka', 'text', 'wiki', 'other')),
  url          text,
  intro        text,
  questions    jsonb not null,             -- [{"q": "...", "o": ["...", ...], "b": номер блока статьи}]
  points       integer not null default 20 check (points between 0 and 100),
  is_published boolean not null default true,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.reading_keys (
  quiz_id bigint primary key references public.reading_quizzes on delete cascade,
  answers integer[] not null               -- номера верных вариантов (с нуля)
);

create table if not exists public.reading_results (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.profiles on delete cascade,
  quiz_id    bigint not null references public.reading_quizzes on delete cascade,
  score      integer not null,
  total      integer not null,
  passed     boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists reading_results_student_idx on public.reading_results (student_id, quiz_id);

create table if not exists public.poem_texts (
  id     text primary key,
  author text not null,
  title  text not null,
  body   text not null
);

create table if not exists public.poems_learned (
  student_id uuid not null references public.profiles on delete cascade,
  poem_id    text not null references public.poem_texts on delete cascade,
  accuracy   numeric not null,
  learned_at timestamptz not null default now(),
  primary key (student_id, poem_id)
);

alter table public.reading_quizzes enable row level security;
alter table public.reading_keys enable row level security;
alter table public.reading_results enable row level security;
alter table public.poem_texts enable row level security;
alter table public.poems_learned enable row level security;

create policy read_published on public.reading_quizzes for select to anon, authenticated
  using (is_published or public.is_teacher());
create policy teacher_all on public.reading_quizzes for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy teacher_all on public.reading_keys for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy teacher_all on public.reading_results for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy own_results on public.reading_results for select to authenticated using (student_id = auth.uid());
create policy teacher_all on public.poem_texts for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy teacher_all on public.poems_learned for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy own_poems on public.poems_learned for select to authenticated using (student_id = auth.uid());

grant select on public.reading_quizzes to anon, authenticated;
grant insert, update, delete on public.reading_quizzes to authenticated;
grant select, insert, update, delete on public.reading_keys, public.poem_texts to authenticated;
grant select on public.reading_results, public.poems_learned to authenticated;
grant insert, update, delete on public.reading_results, public.poems_learned to authenticated;

-- Ответы на тест. Засчитан, если верно не меньше 80%. Очки — один раз за тест.
-- Пока тест не сдан, сервер сообщает только число верных, без разметки по вопросам.
create or replace function public.submit_reading(p_quiz bigint, p_answers integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k integer[]; q record; n integer; s integer := 0; ok boolean; got integer := 0; tries integer;
begin
  if auth.uid() is null or not public.has_access() then raise exception 'no access'; end if;
  select * into q from public.reading_quizzes where id = p_quiz and is_published;
  if not found then raise exception 'quiz not found'; end if;
  select answers into k from public.reading_keys where quiz_id = p_quiz;
  if k is null then raise exception 'quiz not found'; end if;
  select count(*) into tries from public.reading_results
   where student_id = auth.uid() and quiz_id = p_quiz and created_at > now() - interval '1 day';
  if tries >= 10 then raise exception 'too many attempts'; end if;
  n := coalesce(array_length(k, 1), 0);
  for i in 1..n loop
    if p_answers[i] is not null and p_answers[i] = k[i] then s := s + 1; end if;
  end loop;
  ok := n > 0 and s >= ceil(n * 0.8);
  insert into public.reading_results (student_id, quiz_id, score, total, passed) values (auth.uid(), p_quiz, s, n, ok);
  if ok then
    insert into public.xp_events (student_id, kind, points, ref) values (auth.uid(), 'reading', q.points, p_quiz::text)
    on conflict do nothing;
    get diagnostics got = row_count;
  end if;
  return jsonb_build_object('score', s, 'total', n, 'passed', ok,
    'points', case when got > 0 then q.points else 0 end,
    'answers', case when ok then to_jsonb(k) else null end);
end $$;

-- Слова стихотворения без знаков препинания и регистра: «ё» = «е».
create or replace function public.poem_words(t text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(w order by ord), '{}')
    from regexp_split_to_table(
           regexp_replace(lower(replace(replace(t, 'ё', 'е'), 'Ё', 'Е')), '[^а-яa-z0-9]+', ' ', 'g'), ' ')
         with ordinality as x(w, ord)
   where w <> ''
$$;

-- Проверка «наизусть»: доля слов оригинала, совпавших по порядку (наибольшая общая подпоследовательность).
-- 95% и выше — выучено: очки один раз (10 + по 1 за каждые 10 слов, не больше 40).
create or replace function public.check_poem(p_poem text, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a text[]; b text[]; n integer; m integer; prev integer[]; cur integer[]; lcs integer; acc numeric;
  pts integer; got integer := 0; ok boolean;
begin
  if auth.uid() is null or not public.has_access() then raise exception 'no access'; end if;
  select public.poem_words(body) into a from public.poem_texts where id = p_poem;
  if a is null then raise exception 'poem not found'; end if;
  b := public.poem_words(left(coalesce(p_text, ''), 20000));
  n := coalesce(array_length(a, 1), 0);
  m := coalesce(array_length(b, 1), 0);
  if n = 0 or m = 0 then
    return jsonb_build_object('accuracy', 0, 'passed', false, 'points', 0);
  end if;
  prev := array_fill(0, array[m + 1]);
  for i in 1..n loop
    cur := array_fill(0, array[m + 1]);
    for j in 1..m loop
      if a[i] = b[j] then
        cur[j + 1] := prev[j] + 1;
      else
        cur[j + 1] := greatest(prev[j + 1], cur[j]);
      end if;
    end loop;
    prev := cur;
  end loop;
  lcs := prev[m + 1];
  acc := round(lcs::numeric / greatest(n, m), 3);
  ok := acc >= 0.95;
  if ok then
    insert into public.poems_learned (student_id, poem_id, accuracy) values (auth.uid(), p_poem, acc)
    on conflict (student_id, poem_id) do update set accuracy = greatest(public.poems_learned.accuracy, excluded.accuracy);
    pts := least(40, 10 + n / 10);
    insert into public.xp_events (student_id, kind, points, ref) values (auth.uid(), 'poem', pts, p_poem)
    on conflict do nothing;
    get diagnostics got = row_count;
  end if;
  return jsonb_build_object('accuracy', acc, 'passed', ok, 'points', case when got > 0 then pts else 0 end);
end $$;

revoke execute on function public.submit_reading(bigint, integer[]), public.check_poem(text, text) from public, anon;
grant execute on function public.submit_reading(bigint, integer[]), public.check_poem(text, text) to authenticated;
grant execute on function public.poem_words(text) to authenticated;
