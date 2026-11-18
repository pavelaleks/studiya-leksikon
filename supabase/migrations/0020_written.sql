-- Письменная работа (домашнее сочинение и т. п.): отдельный вид работы рядом с занятием,
-- контрольной и пробным экзаменом. Срок сдачи хранится в lesson_items.due_at;
-- сдать можно и после срока — преподаватель видит, что с опозданием.
alter table public.lessons drop constraint if exists lessons_kind_check;
alter table public.lessons add constraint lessons_kind_check check (kind in ('lesson', 'test', 'exam', 'written'));
