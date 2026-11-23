-- Личная ссылка для входа ученика (#/enter/<токен>): открыл — и уже в кабинете, без логина и пароля.
-- Хранится только хеш токена (сам токен видит преподаватель один раз, когда создаёт ссылку).
-- Одна ссылка на ученика: новая заменяет прежнюю. Создаёт и проверяет ссылки функция «admin».

create table if not exists public.student_enter_links (
  student_id   uuid primary key references public.profiles on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  used_count   integer not null default 0,
  last_used_at timestamptz
);

alter table public.student_enter_links enable row level security;

create policy teacher_read on public.student_enter_links for select to authenticated using (public.is_teacher());
create policy teacher_delete on public.student_enter_links for delete to authenticated using (public.is_teacher());

revoke all on public.student_enter_links from anon;
grant select, delete on public.student_enter_links to authenticated;
