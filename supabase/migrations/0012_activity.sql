-- Профиль ученика отдаёт и курсы; журнал посещений для преподавателя.

create or replace view public.me with (security_invoker = true) as
select id, role, status, full_name, email, grade, exam_target, study_format, contact, access_until, created_at, courses
from public.profiles where id = auth.uid();

-- Журнал: какой раздел сайта ученик открыл и когда. Один и тот же раздел пишется не чаще раза в 5 минут.
create table if not exists public.activity_log (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.profiles on delete cascade,
  section    text not null,
  path       text,
  at         timestamptz not null default now()
);
create index if not exists activity_log_student_idx on public.activity_log (student_id, at desc);
create index if not exists activity_log_at_idx on public.activity_log (at desc);

alter table public.activity_log enable row level security;
create policy teacher_all on public.activity_log for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy own_activity on public.activity_log for select to authenticated using (student_id = auth.uid());
grant select, delete on public.activity_log to authenticated;

create or replace function public.log_visit(p_section text, p_path text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_teacher() then return; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then return; end if;
  if exists (select 1 from public.activity_log
              where student_id = auth.uid() and section = left(p_section, 40)
                and at > now() - interval '5 minutes') then
    return;
  end if;
  insert into public.activity_log (student_id, section, path)
  values (auth.uid(), left(coalesce(p_section, '?'), 40), left(p_path, 200));
  -- журнал храним полгода
  delete from public.activity_log where student_id = auth.uid() and at < now() - interval '180 days';
end $$;

revoke execute on function public.log_visit(text, text) from public, anon;
grant execute on function public.log_visit(text, text) to authenticated;
