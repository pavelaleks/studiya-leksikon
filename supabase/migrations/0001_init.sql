-- =====================================================================
--  Студия «Лексикон» — схема Supabase v2 (2026-11-13)
--
--  Модель доступа:
--    гость              → теория, тренажёры, каталог номеров + демо-задания (3 на номер)
--    зарегистрирован    → status = 'pending', ждёт одобрения преподавателя
--    ученик (active)    → весь банк; проверка на сервере; разбор — после попытки
--    преподаватель      → всё + добавление заданий, ученики, проверка работ
--
--  Ключи и разборы лежат в task_keys: у ученика нет на неё ни одного права.
--  Проверка и выдача разбора — только функциями submit_answer / show_solution.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Люди
-- ---------------------------------------------------------------------
create type public.user_role as enum ('student', 'teacher', 'parent');
create type public.user_status as enum ('pending', 'active', 'paused', 'archived');

create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  role         public.user_role not null default 'student',
  status       public.user_status not null default 'pending',
  full_name    text not null default '',
  email        text,
  grade        smallint check (grade between 1 and 11),
  exam_target  text,                       -- ОГЭ / ЕГЭ / ВПР / литература / другое
  study_format text,                       -- online / offline / mixed
  contact      text,                       -- Telegram или телефон для связи (по желанию)
  note         text,                       -- что ученик написал при регистрации
  access_until date,                       -- доступ до (для платных периодов); null = бессрочно
  approved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

-- «Ученик с доступом к материалам»: одобрен и срок не истёк. Преподаватель — тоже да.
create or replace function public.has_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'teacher'
           or (status = 'active' and (access_until is null or access_until >= current_date)))
  );
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, full_name, grade, exam_target, study_format, contact, note)
  values (
    new.id,
    new.email,
    left(coalesce(m ->> 'full_name', ''), 120),
    case when (m ->> 'grade') ~ '^\d{1,2}$' and (m ->> 'grade')::int between 1 and 11
         then (m ->> 'grade')::smallint end,
    left(m ->> 'exam_target', 40),
    left(m ->> 'study_format', 20),
    left(m ->> 'contact', 120),
    left(m ->> 'note', 1000)
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ученик меняет у себя только ФИО, класс, цель, формат и контакт.
-- Функция НЕ security definer: current_user = роль клиента. Из SQL-редактора (postgres) можно всё.
create or replace function public.guard_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_teacher() then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.access_until is distinct from old.access_until
       or new.approved_at is distinct from old.approved_at
       or new.email is distinct from old.email then
      raise exception 'only teacher can change role, status or access';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile();

-- Заметки преподавателя об ученике — отдельная таблица, ученику недоступна.
create table public.student_notes (
  student_id uuid primary key references public.profiles on delete cascade,
  note       text not null default '',
  updated_at timestamptz not null default now()
);

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  format      text not null default 'online' check (format in ('online', 'offline', 'mixed')),
  invite_code text unique default substr(md5(random()::text), 1, 6),
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.group_members (
  group_id   uuid references public.groups on delete cascade,
  student_id uuid references public.profiles on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (group_id, student_id)
);

-- ---------------------------------------------------------------------
-- 2. Банк заданий
-- ---------------------------------------------------------------------
-- source:    'ege-rus' | 'oge-rus' | 'ege-lit'
-- bank_file: 'ege-16' | 'oge-05' | 'ege-01' | 'extra-07' — как в manifest.json сайта
-- source_ref: id задания на сайте (как в адресе #/ege/16/<id>); для своих заданий — 'L<n>'
create table public.passages (
  id   text primary key,           -- 'ege-rus:225' | 'oge-rus:17' | 'ege-lit:2'
  html text not null default '',
  data jsonb                        -- прочие поля текста (автор, заголовок…)
);

create table public.tasks (
  id           bigint generated always as identity primary key,
  source       text not null check (source in ('ege-rus', 'oge-rus', 'ege-lit')),
  bank_file    text not null,
  source_ref   text not null,
  position     integer not null default 0,
  task_no      smallint,
  topic        text,
  topic_id     integer,
  answer_mode  text not null check (answer_mode in
                 ('digits-any', 'digits-fixed', 'word', 'numbers',       -- рус. краткий ответ
                  'lit-short', 'lit-match',                              -- литература
                  'open', 'essay')),                                     -- проверяет преподаватель
  list_item    jsonb not null default '{}'::jsonb,  -- карточка для списка (без ответа)
  data         jsonb not null default '{}'::jsonb,  -- задание целиком (без ответа и разбора)
  passage_id   text references public.passages on delete set null,
  is_demo      boolean not null default false,      -- видно гостям
  is_published boolean not null default true,       -- false = черновик, ученики не видят
  is_own       boolean not null default false,      -- ваше авторское задание
  created_by   uuid references public.profiles on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (source, source_ref)
);
create index tasks_bank_idx on public.tasks (source, bank_file, position);
create index tasks_topic_trgm on public.tasks using gin (topic extensions.gin_trgm_ops);

create table public.task_keys (
  task_id        bigint primary key references public.tasks on delete cascade,
  answer         text,
  answer_norm    text,
  answer_alts    text[] not null default '{}',
  answer_numbers int[],
  solution_html  text,
  teacher_notes  text
);

-- ---------------------------------------------------------------------
-- 3. Занятия (подборки заданий на урок)
-- ---------------------------------------------------------------------
create type public.reveal_policy as enum ('after_attempt', 'after_correct', 'after_due', 'after_review', 'manual');

create table public.lessons (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  group_id    uuid references public.groups on delete cascade,
  student_id  uuid references public.profiles on delete cascade,
  starts_at   timestamptz,
  status      text not null default 'draft' check (status in ('draft', 'live', 'done')),
  notes       text,
  created_at  timestamptz not null default now(),
  check (num_nonnulls(group_id, student_id) = 1)
);

create table public.lesson_items (
  id             uuid primary key default gen_random_uuid(),
  lesson_id      uuid not null references public.lessons on delete cascade,
  task_id        bigint not null references public.tasks on delete cascade,
  position       integer not null default 0,
  kind           text not null default 'classwork' check (kind in ('classwork', 'homework', 'test')),
  reveal         public.reveal_policy not null default 'after_correct',
  attempts_limit smallint default 3,
  due_at         timestamptz,
  revealed       boolean not null default false,
  hidden         boolean not null default false,
  added_at       timestamptz not null default now()
);
create index lesson_items_lesson_idx on public.lesson_items (lesson_id, position);

create or replace function public.can_access_lesson(p_lesson uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_access() and exists (
    select 1 from public.lessons l
    where l.id = p_lesson and l.status <> 'draft' and (
         l.student_id = auth.uid()
      or exists (select 1 from public.group_members gm
                 where gm.group_id = l.group_id and gm.student_id = auth.uid())));
$$;

-- ---------------------------------------------------------------------
-- 4. Ответы учеников
-- ---------------------------------------------------------------------
create table public.attempts (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.profiles on delete cascade,
  task_id    bigint not null references public.tasks on delete cascade,
  item_id    uuid references public.lesson_items on delete set null,
  answer     text not null,
  is_correct boolean not null,
  seconds    integer,
  created_at timestamptz not null default now()
);
create index attempts_student_idx on public.attempts (student_id, created_at desc);
create index attempts_task_idx on public.attempts (task_id);

-- Факт «открыл разбор» — чтобы честно считать задание нерешённым и вернуть в тетрадь ошибок.
create table public.solution_views (
  student_id uuid not null references public.profiles on delete cascade,
  task_id    bigint not null references public.tasks on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (student_id, task_id)
);

create table public.written_works (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.profiles on delete cascade,
  task_id         bigint references public.tasks on delete set null,
  item_id         uuid references public.lesson_items on delete set null,
  body            text not null default '' check (length(body) <= 40000),
  files           text[] not null default '{}',
  status          text not null default 'draft'
                    check (status in ('draft', 'submitted', 'returned', 'graded')),
  submitted_at    timestamptz,
  criteria        jsonb,
  score           numeric(5,1),
  max_score       numeric(5,1),
  teacher_comment text,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index written_works_queue_idx on public.written_works (status, submitted_at);
create index written_works_student_idx on public.written_works (student_id, created_at desc);

create or replace function public.guard_written_work()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_teacher() or current_user not in ('anon', 'authenticated') then
    new.updated_at := now();
    if new.status in ('graded', 'returned') and new.reviewed_at is null then new.reviewed_at := now(); end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not public.has_access() then raise exception 'no access'; end if;
    new.criteria := null; new.score := null; new.max_score := null;
    new.teacher_comment := null; new.reviewed_at := null;
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
  new.student_id := old.student_id; new.task_id := old.task_id;
  if new.status = 'submitted' then new.submitted_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;

create trigger written_works_guard
  before insert or update on public.written_works
  for each row execute function public.guard_written_work();

-- ---------------------------------------------------------------------
-- 5. Проверка ответа (логика answersMatch из russian.js и literature.js)
-- ---------------------------------------------------------------------
create or replace function public.norm_word(t text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(replace(lower(coalesce(t, '')), 'ё', 'е'), '[«»"\s]', '', 'g'),
           '[–—]', '-', 'g'),
         '[.,;:]+$', '');
$$;

create or replace function public.norm_lit(t text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(replace(lower(coalesce(t, '')), 'ё', 'е'), '[«»“”"]', '', 'g'),
             '[–—]', '-', 'g'),
           '\s+', ' ', 'g'),
         '^[.:;\s]+|[.:;\s]+$', '', 'g');
$$;

create or replace function public.digits_of(t text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(t, ''), '\D', '', 'g');
$$;

create or replace function public.sorted_digits(t text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(string_agg(d, '' order by d), '')
  from regexp_split_to_table(public.digits_of(t), '') as d where d <> '';
$$;

create or replace function public.check_answer(k public.task_keys, mode text, raw text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare got_nums int[];
begin
  if k.task_id is null then return false; end if;
  if mode = 'word' then
    return public.norm_word(raw) <> '' and public.norm_word(raw) = any (
      select public.norm_word(x) from unnest(array[k.answer_norm] || k.answer_alts) x where x is not null);
  elsif mode = 'digits-fixed' then
    return public.digits_of(raw) <> '' and public.digits_of(raw) = any (
      select public.digits_of(x) from unnest(array[k.answer_norm, k.answer] || k.answer_alts) x where x is not null);
  elsif mode = 'digits-any' then
    return public.sorted_digits(raw) <> ''
       and public.sorted_digits(raw) = coalesce(nullif(k.answer_norm, ''), public.sorted_digits(k.answer));
  elsif mode = 'numbers' then
    if raw ~ '[\s,;]' and k.answer_numbers is not null then
      select array_agg(x::int order by x::int) into got_nums
      from regexp_split_to_table(trim(raw), '[\s,;]+') x where x ~ '^\d+$';
      return got_nums = (select array_agg(n order by n) from unnest(k.answer_numbers) n);
    end if;
    if k.answer_numbers is not null and (select bool_and(n < 10) from unnest(k.answer_numbers) n) then
      return public.sorted_digits(raw) <> '' and public.sorted_digits(raw) =
        (select string_agg(n::text, '' order by n) from unnest(k.answer_numbers) n);
    end if;
    return public.digits_of(raw) <> '' and public.digits_of(raw) = any (
      select public.digits_of(x) from unnest(array[k.answer, k.answer_norm] || k.answer_alts) x where x is not null);
  elsif mode = 'lit-short' then
    return public.norm_lit(raw) <> '' and public.norm_lit(raw) = any (
      select public.norm_lit(x) from unnest(array[coalesce(k.answer_norm, k.answer)] || k.answer_alts) x where x is not null);
  elsif mode = 'lit-match' then
    return public.digits_of(raw) <> '' and public.digits_of(raw) = any (
      select public.digits_of(x) from unnest(array[coalesce(k.answer_norm, k.answer)] || k.answer_alts) x
      where public.digits_of(x) <> '');
  end if;
  return false;  -- open / essay проверяет преподаватель
end $$;

-- Открыт ли разбор задания из урока (правила урока).
create or replace function public.key_unlocked(p_item uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select i.revealed or case i.reveal
    when 'after_attempt' then exists (select 1 from public.attempts a where a.item_id = i.id and a.student_id = p_student)
    when 'after_correct' then exists (select 1 from public.attempts a where a.item_id = i.id and a.student_id = p_student and a.is_correct)
                           or (i.attempts_limit is not null and
                               (select count(*) from public.attempts a where a.item_id = i.id and a.student_id = p_student) >= i.attempts_limit)
    when 'after_due'     then i.due_at is not null and now() >= i.due_at
    when 'after_review'  then exists (select 1 from public.written_works w
                                       where w.item_id = i.id and w.student_id = p_student and w.status = 'graded')
    when 'manual'        then false
  end
  from public.lesson_items i where i.id = p_item;
$$;

-- Может ли текущий пользователь видеть это задание вообще.
create or replace function public.can_see_task(t public.tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  select t.is_demo
      or public.is_teacher()
      or (t.is_published and public.has_access());
$$;

-- «Проверить». Гость — только демо (без записи). Ученик — любое опубликованное задание.
-- Разбор возвращается сразу только при верном ответе; иначе — кнопка «Показать разбор».
create or replace function public.submit_answer(
  p_task bigint, p_answer text, p_item uuid default null, p_seconds int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks; k public.task_keys; itm public.lesson_items;
  ok boolean; used int := 0; lesson_mode boolean := p_item is not null;
begin
  if length(coalesce(p_answer, '')) > 500 then raise exception 'answer too long'; end if;
  select * into t from public.tasks where id = p_task;
  if not found or not public.can_see_task(t) then raise exception 'no access'; end if;
  if t.answer_mode in ('open', 'essay') then raise exception 'this task is checked by teacher'; end if;
  select * into k from public.task_keys where task_id = p_task;

  if lesson_mode then
    select * into itm from public.lesson_items where id = p_item and task_id = p_task and not hidden;
    if not found or not public.can_access_lesson(itm.lesson_id) then raise exception 'no access'; end if;
    select count(*) into used from public.attempts where item_id = p_item and student_id = auth.uid();
    if itm.attempts_limit is not null and used >= itm.attempts_limit then raise exception 'attempts exhausted'; end if;
    if itm.kind = 'test' and itm.due_at is not null and now() > itm.due_at then raise exception 'deadline passed'; end if;
  end if;

  ok := public.check_answer(k, t.answer_mode, p_answer);

  if auth.uid() is not null then
    insert into public.attempts (student_id, task_id, item_id, answer, is_correct, seconds)
    values (auth.uid(), p_task, p_item, p_answer, ok, p_seconds);
  end if;

  return jsonb_build_object(
    'correct', ok,
    'attempts_left', case when lesson_mode and itm.attempts_limit is not null
                          then itm.attempts_limit - used - 1 end,
    'can_reveal', case when lesson_mode then public.key_unlocked(p_item, auth.uid()) else true end,
    'answer',   case when ok then k.answer end,
    'solution', case when ok then k.solution_html end);
end $$;

-- «Показать разбор». Свободная практика: после хотя бы одной попытки (или сдачи работы).
-- Урок: по правилу урока. Гость: демо-задания — после попытки на клиенте.
create or replace function public.show_solution(p_task bigint, p_item uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.tasks; k public.task_keys; allowed boolean;
begin
  select * into t from public.tasks where id = p_task;
  if not found or not public.can_see_task(t) then raise exception 'no access'; end if;
  if public.is_teacher() or (auth.uid() is null and t.is_demo) then
    allowed := true;
  elsif p_item is not null then
    allowed := public.key_unlocked(p_item, auth.uid());
  else
    allowed := exists (select 1 from public.attempts a where a.task_id = p_task and a.student_id = auth.uid())
            or exists (select 1 from public.written_works w where w.task_id = p_task and w.student_id = auth.uid()
                         and w.status <> 'draft');
  end if;
  if not allowed then return jsonb_build_object('locked', true); end if;
  select * into k from public.task_keys where task_id = p_task;
  if auth.uid() is not null and not public.is_teacher()
     and not exists (select 1 from public.attempts a where a.task_id = p_task and a.student_id = auth.uid() and a.is_correct) then
    insert into public.solution_views (student_id, task_id) values (auth.uid(), p_task) on conflict do nothing;
  end if;
  return jsonb_build_object('locked', false, 'answer', k.answer, 'solution', k.solution_html);
end $$;

create or replace function public.join_group(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into g from public.groups where invite_code = lower(trim(p_code)) and not archived;
  if g is null then raise exception 'invalid code'; end if;
  insert into public.group_members (group_id, student_id) values (g, auth.uid()) on conflict do nothing;
  return g;
end $$;

-- ---------------------------------------------------------------------
-- 6. Функции преподавателя: добавление заданий (одно / форма / пакет / импорт)
-- ---------------------------------------------------------------------
-- items: [{source, bank_file, source_ref?, position?, task_no, topic, topic_id, answer_mode,
--          list_item, data, passage_id, is_demo, is_published, is_own,
--          key: {answer, answer_norm, answer_alts[], answer_numbers[], solution_html, teacher_notes}}]
-- Без source_ref создаётся новое авторское задание с id 'L<n>'. Возвращает [{id, source_ref}].
create or replace function public.teacher_upsert_tasks(items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it jsonb; tid bigint; ref text; out jsonb := '[]'::jsonb; kj jsonb;
begin
  if not public.is_teacher() then raise exception 'teacher only'; end if;
  for it in select * from jsonb_array_elements(items) loop
    ref := nullif(it ->> 'source_ref', '');
    insert into public.tasks as t (source, bank_file, source_ref, position, task_no, topic, topic_id,
                                   answer_mode, list_item, data, passage_id, is_demo, is_published, is_own, created_by)
    values (it ->> 'source', it ->> 'bank_file', coalesce(ref, 'tmp-' || gen_random_uuid()),
            coalesce((it ->> 'position')::int, 1000000), (it ->> 'task_no')::smallint, it ->> 'topic',
            (it ->> 'topic_id')::int, it ->> 'answer_mode',
            coalesce(it -> 'list_item', '{}'::jsonb), coalesce(it -> 'data', '{}'::jsonb),
            nullif(it ->> 'passage_id', ''),
            coalesce((it ->> 'is_demo')::boolean, false), coalesce((it ->> 'is_published')::boolean, true),
            coalesce((it ->> 'is_own')::boolean, ref is null), auth.uid())
    on conflict (source, source_ref) do update set
      bank_file = excluded.bank_file, position = excluded.position, task_no = excluded.task_no,
      topic = excluded.topic, topic_id = excluded.topic_id, answer_mode = excluded.answer_mode,
      list_item = excluded.list_item, data = excluded.data, passage_id = excluded.passage_id,
      is_demo = excluded.is_demo, is_published = excluded.is_published, updated_at = now()
    returning t.id into tid;
    if ref is null then
      ref := 'L' || tid;
      update public.tasks set source_ref = ref,
        data = data || jsonb_build_object('id', ref),
        list_item = list_item || jsonb_build_object('id', ref)
      where id = tid;
    end if;
    kj := coalesce(it -> 'key', '{}'::jsonb);
    insert into public.task_keys (task_id, answer, answer_norm, answer_alts, answer_numbers, solution_html, teacher_notes)
    values (tid, kj ->> 'answer', kj ->> 'answer_norm',
            coalesce((select array_agg(x) from jsonb_array_elements_text(kj -> 'answer_alts') x), '{}'),
            (select array_agg(x::int) from jsonb_array_elements_text(kj -> 'answer_numbers') x),
            kj ->> 'solution_html', kj ->> 'teacher_notes')
    on conflict (task_id) do update set
      answer = excluded.answer, answer_norm = excluded.answer_norm, answer_alts = excluded.answer_alts,
      answer_numbers = excluded.answer_numbers, solution_html = excluded.solution_html,
      teacher_notes = coalesce(excluded.teacher_notes, public.task_keys.teacher_notes);
    out := out || jsonb_build_object('id', tid, 'source_ref', ref);
  end loop;
  return out;
end $$;

create or replace function public.teacher_upsert_passages(items jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.is_teacher() then raise exception 'teacher only'; end if;
  insert into public.passages (id, html, data)
  select x ->> 'id', coalesce(x ->> 'html', ''), x -> 'data' from jsonb_array_elements(items) x
  on conflict (id) do update set html = excluded.html, data = excluded.data;
  get diagnostics n = row_count;
  return n;
end $$;

-- Задание целиком для редактирования (вместе с ключом).
create or replace function public.teacher_get_task(p_task bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_teacher() then raise exception 'teacher only'; end if;
  return (select to_jsonb(t) || jsonb_build_object('key', to_jsonb(k))
          from public.tasks t left join public.task_keys k on k.task_id = t.id where t.id = p_task);
end $$;

-- Одобрить ученика (и при желании сразу добавить в группу).
create or replace function public.teacher_set_student(
  p_student uuid, p_status public.user_status, p_group uuid default null, p_until date default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_teacher() then raise exception 'teacher only'; end if;
  update public.profiles
     set status = p_status, access_until = p_until,
         approved_at = case when p_status = 'active' then coalesce(approved_at, now()) else approved_at end
   where id = p_student and role <> 'teacher';
  if p_group is not null then
    insert into public.group_members (group_id, student_id) values (p_group, p_student) on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Представления
-- ---------------------------------------------------------------------
-- Свой профиль без заметки преподавателя.
create or replace view public.me with (security_invoker = true) as
select id, role, status, full_name, email, grade, exam_target, study_format, contact, access_until, created_at
from public.profiles where id = auth.uid();

-- Тетрадь ошибок: последняя попытка неверна ИЛИ разбор открыт до верного ответа.
create or replace view public.my_mistakes with (security_invoker = true) as
with last as (
  select distinct on (a.task_id) a.task_id, a.answer, a.is_correct, a.created_at
  from public.attempts a where a.student_id = auth.uid()
  order by a.task_id, a.created_at desc
)
select t.id as task_id, t.source, t.bank_file, t.source_ref, t.task_no, t.topic,
       l.answer as last_answer, l.created_at as last_try,
       (sv.task_id is not null) as viewed_solution
from public.tasks t
left join last l on l.task_id = t.id
left join public.solution_views sv on sv.task_id = t.id and sv.student_id = auth.uid()
where (l.task_id is not null and not l.is_correct)
   or (sv.task_id is not null and coalesce(l.is_correct, false) = false);

-- Статистика по номерам (ученик видит свою, преподаватель — всех).
create or replace view public.task_stats with (security_invoker = true) as
select a.student_id, t.source, t.task_no,
       count(*)                            as tries,
       count(distinct a.task_id)           as tasks_seen,
       count(distinct a.task_id) filter (where a.is_correct) as tasks_solved,
       round(avg(a.is_correct::int) * 100) as pct_correct,
       max(a.created_at)                   as last_activity
from public.attempts a join public.tasks t on t.id = a.task_id
group by a.student_id, t.source, t.task_no;

-- ---------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.student_notes  enable row level security;
alter table public.group_members  enable row level security;
alter table public.passages       enable row level security;
alter table public.tasks          enable row level security;
alter table public.task_keys      enable row level security;
alter table public.lessons        enable row level security;
alter table public.lesson_items   enable row level security;
alter table public.attempts       enable row level security;
alter table public.solution_views enable row level security;
alter table public.written_works  enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array['profiles','student_notes','groups','group_members','passages','tasks','task_keys',
    'lessons','lesson_items','attempts','solution_views','written_works']
  loop
    execute format('create policy teacher_all on public.%I for all to authenticated
                    using (public.is_teacher()) with check (public.is_teacher())', tbl);
  end loop;
end $$;

create policy own_profile_read on public.profiles for select to authenticated using (id = auth.uid());
create policy own_profile_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy member_groups on public.groups for select to authenticated
  using (exists (select 1 from public.group_members m where m.group_id = groups.id and m.student_id = auth.uid()));
create policy own_membership on public.group_members for select to authenticated using (student_id = auth.uid());

create policy tasks_visible on public.tasks for select to anon, authenticated
  using (is_demo or (is_published and public.has_access()));
create policy passages_visible on public.passages for select to anon, authenticated
  using (public.has_access()
         or exists (select 1 from public.tasks t where t.passage_id = passages.id and t.is_demo));
-- task_keys: политик для учеников и гостей нет.

create policy student_lessons on public.lessons for select to authenticated using (public.can_access_lesson(id));
create policy student_items on public.lesson_items for select to authenticated
  using (not hidden and public.can_access_lesson(lesson_id));

create policy own_attempts on public.attempts for select to authenticated using (student_id = auth.uid());
create policy own_views on public.solution_views for select to authenticated using (student_id = auth.uid());

create policy own_works_read on public.written_works for select to authenticated using (student_id = auth.uid());
create policy own_works_insert on public.written_works for insert to authenticated
  with check (student_id = auth.uid());
create policy own_works_update on public.written_works for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- Права на функции: по умолчанию EXECUTE есть у PUBLIC — закрываем внутренние.
revoke execute on function public.check_answer(public.task_keys, text, text) from public, anon, authenticated;
revoke execute on function public.key_unlocked(uuid, uuid)                   from public, anon, authenticated;
revoke execute on function public.handle_new_user()                          from public, anon, authenticated;
revoke execute on function public.teacher_upsert_tasks(jsonb)                from public, anon;
revoke execute on function public.teacher_upsert_passages(jsonb)             from public, anon;
revoke execute on function public.teacher_get_task(bigint)                   from public, anon;
revoke execute on function public.teacher_set_student(uuid, public.user_status, uuid, date) from public, anon;
revoke execute on function public.join_group(text)                           from public, anon;
grant  execute on function public.teacher_upsert_tasks(jsonb)                to authenticated;
grant  execute on function public.teacher_upsert_passages(jsonb)             to authenticated;
grant  execute on function public.teacher_get_task(bigint)                   to authenticated;
grant  execute on function public.teacher_set_student(uuid, public.user_status, uuid, date) to authenticated;
grant  execute on function public.join_group(text)                           to authenticated;
grant  execute on function public.submit_answer(bigint, text, uuid, int)     to anon, authenticated;
grant  execute on function public.show_solution(bigint, uuid)                to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Storage: фото тетрадей (приватно, папка = id ученика)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('works', 'works', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy works_own_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'works' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access());
create policy works_read on storage.objects for select to authenticated
  using (bucket_id = 'works' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_teacher()));

-- ---------------------------------------------------------------------
-- 10. Realtime: преподаватель видит ответы и сданные работы сразу
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.attempts, public.written_works, public.lesson_items;
