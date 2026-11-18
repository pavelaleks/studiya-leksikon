-- Учеников создаёт преподаватель сам — сообщение «🙋 Новая заявка» в Telegram больше не нужно
-- (оно приходило при каждом создании ученика: профиль сначала появляется со статусом «ждёт»).
drop trigger if exists profiles_tg on public.profiles;
drop function if exists public.tg_on_profile();
