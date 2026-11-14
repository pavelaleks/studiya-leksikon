-- Какой вариант выбрал ученик: в задании 4 ЕГЭ по литературе — вопрос 1 или 2,
-- в задании 11 — одна из пяти тем. Преподаватель видит выбранный вариант при проверке.
alter table public.written_works add column if not exists choice smallint check (choice between 1 and 9);
