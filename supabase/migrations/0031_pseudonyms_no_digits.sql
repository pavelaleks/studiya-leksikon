-- Псевдонимы учеников без цифр: «Ясный Кедр 94» → «Ясный Кедр». Логины для входа не меняются.
-- Совпали бы «Зоркая Комета 50» и «Зоркая Комета 48» — второй даём «Янтарная Комета».
update public.profiles set full_name = 'Янтарная Комета'
 where role <> 'teacher' and full_name = 'Зоркая Комета 48';
update public.profiles set full_name = regexp_replace(full_name, '\s+\d+$', '')
 where role <> 'teacher' and full_name ~ '\s\d+$';
-- проверка: повторов быть не должно
select full_name, count(*) from public.profiles where role <> 'teacher' group by 1 having count(*) > 1;
