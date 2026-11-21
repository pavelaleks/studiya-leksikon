-- Кнопка «напомнить» на странице «Сегодня»: преподаватель отправляет напоминание о несданной работе.
-- Уходит только тем, кто подключил Telegram; одно напоминание на работу и ученика в день.
-- Возвращает, скольким ученикам напоминание поставлено в очередь.
create or replace function public.teacher_nudge(p_lesson uuid, p_students uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare t text; sid uuid; n int := 0; today text := to_char(now() at time zone 'Asia/Barnaul', 'YYYY-MM-DD');
begin
  if not public.is_teacher() then raise exception 'no access'; end if;
  select title into t from public.lessons where id = p_lesson;
  if t is null then raise exception 'lesson not found'; end if;
  foreach sid in array coalesce(p_students, '{}') loop
    if exists (select 1 from public.profiles where id = sid and tg_chat_id is not null) then
      perform public.notify(sid, 'nudge', p_lesson::text || '-' || today,
        '📝 Напоминание от преподавателя: работа «' || t || '» ещё не сдана. Сдай, пожалуйста, как можно скорее.',
        'lesson/' || p_lesson);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.teacher_nudge(uuid, uuid[]) from public, anon;
grant execute on function public.teacher_nudge(uuid, uuid[]) to authenticated;
