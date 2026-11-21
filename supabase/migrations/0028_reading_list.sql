-- Список обязательного чтения (ОГЭ/ЕГЭ по литературе): ученик отмечает прочитанное.
-- Сам список лежит на сайте (js/reading-canon.js), в базе — только отметки ученика.

create table if not exists public.reading_marks (
  student_id uuid not null references public.profiles on delete cascade,
  exam       text not null check (exam in ('oge', 'ege')),
  code       text not null check (length(code) <= 12),
  note       text check (length(note) <= 300),   -- что именно прочитано (для пунктов «по выбору»)
  read_at    timestamptz not null default now(),
  primary key (student_id, exam, code)
);

alter table public.reading_marks enable row level security;

create policy own_marks on public.reading_marks for all to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.has_access());
create policy teacher_read on public.reading_marks for select to authenticated
  using (public.is_teacher());

grant select, insert, update, delete on public.reading_marks to authenticated;

-- Даты экзаменов (exam_date_oge_lit, exam_date_ege_lit) преподаватель задаёт в настройках кабинета.
create policy teacher_write on public.app_settings for all to authenticated
  using (public.is_teacher() and key like 'exam_date_%')
  with check (public.is_teacher() and key like 'exam_date_%');
grant insert, update, delete on public.app_settings to authenticated;
