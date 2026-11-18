-- Расписание из Google Календаря: секретная iCal-ссылка преподавателя и сопоставление
-- «серия событий календаря → группа или ученик». Ключ сопоставления — UID серии из календаря
-- (непрозрачный идентификатор), поэтому названия событий (в них могут быть настоящие имена) в базе не хранятся.
-- Сами события не сохраняются: их по запросу читает функция «calendar».
create table if not exists public.teacher_calendar (
  teacher_id uuid primary key default auth.uid() references public.profiles on delete cascade,
  ics_url    text check (ics_url is null or ics_url ~ '^https://'),
  map        jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.teacher_calendar enable row level security;
drop policy if exists own_calendar on public.teacher_calendar;
create policy own_calendar on public.teacher_calendar for all to authenticated
  using (teacher_id = auth.uid() and public.is_teacher())
  with check (teacher_id = auth.uid() and public.is_teacher());
grant select, insert, update, delete on public.teacher_calendar to authenticated;
