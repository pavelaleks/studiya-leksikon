-- Курсы ученика (несколько: русский и литература, любой класс) и запросы на новые курсы.
-- Удаление ученика преподавателем.

-- Курс — «предмет:класс»: rus:5 … rus:11, lit:5 … lit:11.
alter table public.profiles add column if not exists courses text[] not null default '{}';

-- Начальное заполнение из того, что ученик указал при регистрации.
update public.profiles p set courses = array[
  case
    when p.exam_target ilike '%литератур%' then 'lit:' || coalesce(least(greatest(p.grade, 5), 11), 11)
    when p.exam_target ilike '%ОГЭ%' then 'rus:9'
    when p.exam_target ilike '%ЕГЭ%' then 'rus:' || greatest(coalesce(p.grade, 11), 10)
    when p.grade between 5 and 11 then 'rus:' || p.grade
    else 'rus:11'
  end]
where p.role = 'student' and cardinality(p.courses) = 0;

-- Ученик не может сам дописать себе курс.
create or replace function public.guard_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_teacher() then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.access_until is distinct from old.access_until
       or new.approved_at is distinct from old.approved_at
       or new.email is distinct from old.email
       or new.courses is distinct from old.courses then
      raise exception 'only teacher can change role, status, access or courses';
    end if;
  end if;
  return new;
end $$;

create table if not exists public.course_requests (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.profiles on delete cascade,
  course      text not null check (course ~ '^(rus|lit):([5-9]|1[01])$'),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  unique (student_id, course)
);
alter table public.course_requests enable row level security;
create policy teacher_all on public.course_requests for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy own_requests on public.course_requests for select to authenticated using (student_id = auth.uid());
grant select, insert, update, delete on public.course_requests to authenticated;

-- Ученик просит курс (повторный запрос после отказа снова ставит его в очередь).
create or replace function public.request_course(p_course text)
returns text language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if auth.uid() is null then raise exception 'no access'; end if;
  if p_course !~ '^(rus|lit):([5-9]|1[01])$' then raise exception 'bad course'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and p_course = any (courses)) then
    return 'already';
  end if;
  insert into public.course_requests (student_id, course) values (auth.uid(), p_course)
  on conflict (student_id, course) do update set status = 'pending', created_at = now(), decided_at = null
  returning status into st;
  return st;
end $$;

-- Преподаватель решает: при согласии курс добавляется ученику.
create or replace function public.decide_course_request(p_id bigint, p_ok boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.is_teacher() then raise exception 'teacher only'; end if;
  update public.course_requests set status = case when p_ok then 'approved' else 'declined' end, decided_at = now()
   where id = p_id returning * into r;
  if r is null then raise exception 'not found'; end if;
  if p_ok then
    update public.profiles set courses = array(select distinct unnest(courses || r.course) order by 1)
     where id = r.student_id;
  end if;
end $$;

-- Удалить ученика целиком: учётная запись, профиль и всё, что к нему привязано (ответы, работы, очки…).
-- Файлы фото работ удаляет сайт через хранилище до вызова (прямое удаление из storage запрещено).
create or replace function public.teacher_delete_student(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_teacher() then raise exception 'teacher only'; end if;
  if not exists (select 1 from public.profiles where id = p_id and role <> 'teacher') then
    raise exception 'not a student';
  end if;
  delete from auth.users where id = p_id;
end $$;

revoke execute on function public.request_course(text), public.decide_course_request(bigint, boolean),
  public.teacher_delete_student(uuid) from public, anon;
grant execute on function public.request_course(text), public.decide_course_request(bigint, boolean),
  public.teacher_delete_student(uuid) to authenticated;
