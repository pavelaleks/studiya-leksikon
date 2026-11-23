-- Настоящие имена учеников — только для преподавателя. Ученики на сайте остаются под псевдонимами:
-- ни сами ученики, ни другие ученики эту таблицу не видят (нет политик для них).

create table if not exists public.student_names (
  student_id uuid primary key references public.profiles on delete cascade,
  real_name  text not null check (length(real_name) between 1 and 120),
  updated_at timestamptz not null default now()
);

alter table public.student_names enable row level security;

create policy teacher_all on public.student_names for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

revoke all on public.student_names from anon;
grant select, insert, update, delete on public.student_names to authenticated;
