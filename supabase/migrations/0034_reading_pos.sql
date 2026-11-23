-- Закладка в тексте библиотеки: глава и абзац, где остановился читатель.
-- У вошедших хранится в базе, чтобы место переходило между телефоном и компьютером; у гостей — только в браузере.

create table if not exists public.reading_pos (
  user_id    uuid not null references public.profiles on delete cascade,
  work_id    text not null check (length(work_id) <= 40),
  ch         integer not null check (ch between 1 and 2000),
  para       integer not null default 0 check (para between 0 and 100000),
  pct        smallint not null default 0 check (pct between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

alter table public.reading_pos enable row level security;

create policy own_pos on public.reading_pos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy teacher_read on public.reading_pos for select to authenticated using (public.is_teacher());

revoke all on public.reading_pos from anon;
grant select, insert, update, delete on public.reading_pos to authenticated;
